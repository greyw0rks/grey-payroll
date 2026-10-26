/**
 * Tests for src/grey/storage.ts
 *
 * Covers: scoping, upsertRun dedup, immutable snapshots, txHash never downgraded,
 * write failure detection (StorageWriteError), requireDurableWrite blocks,
 * patchRun, loadState version mismatch, pending/unknown reload recovery,
 * account-switch scope isolation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  loadState,
  upsertRun,
  patchRun,
  requireDurableWrite,
  saveDraft,
  StorageWriteError,
  STORAGE_VERSION,
} from '../storage'
import type { PayrollRun, SubmissionSnapshot } from '../types'

// ─── localStorage mock ───────────────────────────────────────────────────────

const store: Record<string, string> = {}
const storageMock = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v },
  removeItem: (k: string) => { delete store[k] },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]) },
}

beforeEach(() => {
  storageMock.clear()
  vi.stubGlobal('localStorage', storageMock)
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

const C = 5042002
const CONTRACT = '0xCB8a8E81E50dF0BeBDcE1E1b50ABa42a1B40A0c3'
const EMP = '0xdAC17F958D2ee523a2206206994597C13D831ec7'

function makeSnapshot(runId: string): SubmissionSnapshot {
  return {
    employer: EMP,
    chainId: C,
    contractAddress: CONTRACT,
    runId,
    recipients: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
    amounts: ['1000000000000000000'],
    totalAmount: '1000000000000000000',
    signedAt: new Date().toISOString(),
  }
}

function makeRun(runId: string, status: PayrollRun['status'] = 'pending', txHash: string | null = null): PayrollRun {
  return {
    runId,
    txHash,
    chainId: C,
    contractAddress: CONTRACT,
    employer: EMP,
    snapshot: makeSnapshot(runId),
    recipients: [{ address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', amountStr: '1000000000000000000' }],
    submittedAt: new Date().toISOString(),
    status,
    explorerUrl: null,
    verification: null,
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('loadState', () => {
  it('returns empty state when nothing stored', () => {
    const s = loadState(C, CONTRACT, EMP)
    expect(s.runs).toEqual([])
    expect(s.draft).toBeNull()
  })

  it('returns empty state for version mismatch', () => {
    const old = { version: 1, draft: null, runs: [{ runId: 'old' }], contractConfig: null }
    store[`grey-payroll:v${STORAGE_VERSION}:${C}:${CONTRACT.toLowerCase()}:${EMP.toLowerCase()}`] =
      JSON.stringify(old)
    const s = loadState(C, CONTRACT, EMP)
    expect(s.runs).toEqual([])
  })

  it('restores saved state', () => {
    const run = makeRun('0x' + 'a'.repeat(64))
    upsertRun(C, CONTRACT, EMP, run)
    const s = loadState(C, CONTRACT, EMP)
    expect(s.runs).toHaveLength(1)
    expect(s.runs[0].runId).toBe(run.runId)
  })
})

describe('upsertRun — deduplication', () => {
  it('does not create duplicates when called with same runId', () => {
    const run = makeRun('0x' + '1'.repeat(64))
    upsertRun(C, CONTRACT, EMP, run)
    upsertRun(C, CONTRACT, EMP, { ...run, status: 'confirmed' })
    const s = loadState(C, CONTRACT, EMP)
    expect(s.runs).toHaveLength(1)
    expect(s.runs[0].status).toBe('confirmed')
  })

  it('prepends new runs', () => {
    const runA = makeRun('0x' + 'a'.repeat(64))
    const runB = makeRun('0x' + 'b'.repeat(64))
    upsertRun(C, CONTRACT, EMP, runA)
    upsertRun(C, CONTRACT, EMP, runB)
    const s = loadState(C, CONTRACT, EMP)
    expect(s.runs[0].runId).toBe(runB.runId) // newest first
  })
})

describe('upsertRun — immutable snapshot', () => {
  it('never overwrites the original snapshot', () => {
    const run = makeRun('0x' + '2'.repeat(64))
    upsertRun(C, CONTRACT, EMP, run)

    const differentSnapshot = {
      ...makeSnapshot('0x' + '2'.repeat(64)),
      totalAmount: '99999',
    }
    upsertRun(C, CONTRACT, EMP, { ...run, snapshot: differentSnapshot })

    const s = loadState(C, CONTRACT, EMP)
    // Snapshot must be the original
    expect(s.runs[0].snapshot?.totalAmount).toBe('1000000000000000000')
  })

  it('never overwrites submittedAt', () => {
    const original = new Date('2026-01-01').toISOString()
    const run = { ...makeRun('0x' + '3'.repeat(64)), submittedAt: original }
    upsertRun(C, CONTRACT, EMP, run)
    upsertRun(C, CONTRACT, EMP, { ...run, submittedAt: new Date('2030-01-01').toISOString() })
    const s = loadState(C, CONTRACT, EMP)
    expect(s.runs[0].submittedAt).toBe(original)
  })
})

describe('upsertRun — txHash never downgraded', () => {
  it('keeps known txHash when patch passes null', () => {
    const knownHash = '0x' + 'f'.repeat(64)
    const run = makeRun('0x' + '4'.repeat(64), 'pending', knownHash)
    upsertRun(C, CONTRACT, EMP, run)
    // Patch with null txHash
    upsertRun(C, CONTRACT, EMP, { ...run, txHash: null })
    const s = loadState(C, CONTRACT, EMP)
    expect(s.runs[0].txHash).toBe(knownHash)
  })

  it('updates txHash from null to a real value', () => {
    const run = makeRun('0x' + '5'.repeat(64), 'pending', null)
    upsertRun(C, CONTRACT, EMP, run)
    const newHash = '0x' + 'e'.repeat(64)
    upsertRun(C, CONTRACT, EMP, { ...run, txHash: newHash })
    const s = loadState(C, CONTRACT, EMP)
    expect(s.runs[0].txHash).toBe(newHash)
  })
})

describe('patchRun', () => {
  it('patches status without touching snapshot or submittedAt', () => {
    const run = makeRun('0x' + '6'.repeat(64))
    upsertRun(C, CONTRACT, EMP, run)
    patchRun(C, CONTRACT, EMP, run.runId, { status: 'confirmed' })
    const s = loadState(C, CONTRACT, EMP)
    expect(s.runs[0].status).toBe('confirmed')
    expect(s.runs[0].snapshot?.totalAmount).toBe('1000000000000000000')
    expect(s.runs[0].submittedAt).toBe(run.submittedAt)
  })

  it('is a no-op for unknown runId', () => {
    patchRun(C, CONTRACT, EMP, '0x' + 'z'.repeat(64), { status: 'confirmed' })
    // Should not throw
    const s = loadState(C, CONTRACT, EMP)
    expect(s.runs).toHaveLength(0)
  })
})

describe('requireDurableWrite', () => {
  it('returns null on successful write', () => {
    const run = makeRun('0x' + '7'.repeat(64))
    const err = requireDurableWrite(C, CONTRACT, EMP, run)
    expect(err).toBeNull()
  })

  it('returns StorageWriteError when localStorage.setItem throws', () => {
    const failStorage = {
      ...storageMock,
      setItem: () => { throw new DOMException('QuotaExceededError') },
    }
    vi.stubGlobal('localStorage', failStorage)

    const run = makeRun('0x' + '8'.repeat(64))
    const err = requireDurableWrite(C, CONTRACT, EMP, run)
    expect(err).toBeInstanceOf(StorageWriteError)
    expect(err?.message).toContain('localStorage write failed')

    // Restore
    vi.stubGlobal('localStorage', storageMock)
  })
})

describe('scope isolation', () => {
  it('different employers have separate scopes', () => {
    const emp2 = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    const runForEmp1 = makeRun('0x' + 'a'.repeat(64))
    const runForEmp2 = { ...makeRun('0x' + 'b'.repeat(64)), employer: emp2 }

    upsertRun(C, CONTRACT, EMP, runForEmp1)
    upsertRun(C, CONTRACT, emp2, runForEmp2)

    const stateEmp1 = loadState(C, CONTRACT, EMP)
    const stateEmp2 = loadState(C, CONTRACT, emp2)

    expect(stateEmp1.runs[0].runId).toBe(runForEmp1.runId)
    expect(stateEmp2.runs[0].runId).toBe(runForEmp2.runId)
    // Not cross-contaminated
    expect(stateEmp1.runs.some((r) => r.runId === runForEmp2.runId)).toBe(false)
    expect(stateEmp2.runs.some((r) => r.runId === runForEmp1.runId)).toBe(false)
  })

  it('different chainIds have separate scopes', () => {
    const run1 = makeRun('0x' + 'c'.repeat(64))
    const run2 = { ...makeRun('0x' + 'd'.repeat(64)), chainId: 5042 }
    upsertRun(5042002, CONTRACT, EMP, run1)
    upsertRun(5042, CONTRACT, EMP, run2)

    const s1 = loadState(5042002, CONTRACT, EMP)
    const s2 = loadState(5042, CONTRACT, EMP)
    expect(s1.runs[0].runId).toBe(run1.runId)
    expect(s2.runs[0].runId).toBe(run2.runId)
  })

  it('different contract addresses have separate scopes', () => {
    const contract2 = '0xabc0000000000000000000000000000000000002'
    const runA = makeRun('0x' + 'e'.repeat(64))
    const runB = { ...makeRun('0x' + 'f'.repeat(64)), contractAddress: contract2 }
    upsertRun(C, CONTRACT, EMP, runA)
    upsertRun(C, contract2, EMP, runB)

    const sA = loadState(C, CONTRACT, EMP)
    const sB = loadState(C, contract2, EMP)
    expect(sA.runs[0].runId).toBe(runA.runId)
    expect(sB.runs[0].runId).toBe(runB.runId)
  })
})

describe('saveDraft', () => {
  it('saves and reloads draft', () => {
    const draft = {
      runId: '0x' + 'a'.repeat(64),
      runIdGeneratedAt: new Date().toISOString(),
      rows: [{ id: '1', address: '0x' + '1'.repeat(40), amountStr: '1.0' }],
      confirmed: false,
      chainId: C,
      contractAddress: CONTRACT,
      employer: EMP,
    }
    saveDraft(C, CONTRACT, EMP, draft)
    const s = loadState(C, CONTRACT, EMP)
    expect(s.draft?.runId).toBe(draft.runId)
    expect(s.draft?.rows).toHaveLength(1)
  })

  it('clears draft on null', () => {
    saveDraft(C, CONTRACT, EMP, null)
    const s = loadState(C, CONTRACT, EMP)
    expect(s.draft).toBeNull()
  })
})

describe('pending/unknown run recovery on reload', () => {
  it('reloads a pending run with its original runId and txHash', () => {
    const runId = '0x' + '9'.repeat(64)
    const txHash = '0x' + 'f'.repeat(64)
    upsertRun(C, CONTRACT, EMP, makeRun(runId, 'pending', txHash))

    const s = loadState(C, CONTRACT, EMP)
    expect(s.runs[0].runId).toBe(runId)
    expect(s.runs[0].txHash).toBe(txHash)
    expect(s.runs[0].status).toBe('pending')
  })

  it('reloads an unknown run without downgrading to failed', () => {
    const runId = '0x' + '0'.repeat(63) + '1'
    upsertRun(C, CONTRACT, EMP, makeRun(runId, 'unknown', '0x' + '1'.repeat(64)))
    const s = loadState(C, CONTRACT, EMP)
    expect(s.runs[0].status).toBe('unknown')
  })
})
