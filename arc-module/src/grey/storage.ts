/**
 * Grey Payroll — localStorage persistence.
 *
 * All state is scoped by: chainId + contractAddress + employerAddress.
 * Amount strings are stored as strings, never floats.
 * Version 4 — added durable write guard (tryWriteRun) and explicit write-failure
 *             error type so callers can block signing on persistence failure.
 *
 * Migration: version < 4 data is discarded (no lossy upgrade attempted).
 *
 * DURABILITY CONTRACT:
 * - tryWriteRun / requireDurableWrite MUST be called (and awaited/checked) BEFORE
 *   showing the wallet signing prompt. If storage is unavailable, the employer
 *   should not sign — they cannot recover the runId/hash on reload.
 * - Upsert preserves immutable snapshots and never downgrades a txHash from a
 *   known value to null.
 * - Pending/unknown records reload with their original runId; IDs never change.
 * - Account switch to an empty scope resets confirmation/draft/history at
 *   the scope-load boundary (enforced by PayrollWorkspace, not storage).
 */
import type { StoredAppState, PayrollDraft, PayrollRun, ChainContractConfig } from './types'
import { getPlatformContext } from './platform'

export const STORAGE_VERSION = 4

// ─── Error type ─────────────────────────────────────────────────────────────

export class StorageWriteError extends Error {
  constructor(readonly cause: unknown) {
    super('localStorage write failed — storage may be full or blocked.')
    this.name = 'StorageWriteError'
  }
}

// ─── Scope key ─────────────────────────────────────────────────────────────

function scopeKey(chainId: number, contractAddress: string, employer: string): string {
  const company = getPlatformContext()?.companyId
  return `grey-payroll:v${STORAGE_VERSION}:${chainId}:${contractAddress.toLowerCase()}:${employer.toLowerCase()}${company ? `:company:${company}` : ''}`
}

/** Chain-level contract config is NOT employer-scoped. */
function chainConfigKey(chainId: number): string {
  const company = getPlatformContext()?.companyId
  return `grey-payroll:chain-config:v${STORAGE_VERSION}:${chainId}${company ? `:company:${company}` : ''}`
}

// ─── Empty state ────────────────────────────────────────────────────────────

function emptyState(
  chainId: number,
  contractAddress: string,
): StoredAppState {
  return {
    version: STORAGE_VERSION as 3,
    draft: null,
    runs: [],
    contractConfig: { chainId, address: contractAddress, deployBlock: 0, verified: false, verifiedAt: null },
  }
}

// ─── Load / save ────────────────────────────────────────────────────────────

export function loadState(
  chainId: number,
  contractAddress: string,
  employer: string,
): StoredAppState {
  try {
    const raw = localStorage.getItem(scopeKey(chainId, contractAddress, employer))
    if (!raw) return emptyState(chainId, contractAddress)
    const parsed = JSON.parse(raw) as StoredAppState
    // Accept version 3 or 4 (field-compatible); stored version is a number at runtime
    const storedVersion = (parsed as unknown as { version: number }).version
    if (storedVersion !== STORAGE_VERSION && storedVersion !== 3) {
      return emptyState(chainId, contractAddress)
    }
    return parsed
  } catch {
    return emptyState(chainId, contractAddress)
  }
}

/**
 * Write state to localStorage.
 * Throws StorageWriteError if the write fails (e.g. storage full, private browsing).
 */
export function saveState(
  chainId: number,
  contractAddress: string,
  employer: string,
  state: StoredAppState,
): void {
  try {
    localStorage.setItem(
      scopeKey(chainId, contractAddress, employer),
      JSON.stringify({ ...state, version: STORAGE_VERSION }),
    )
  } catch (cause) {
    throw new StorageWriteError(cause)
  }
}

/**
 * Try to write state; returns null on success, StorageWriteError on failure.
 * Use this when you need to surface write failures to the caller without
 * throwing (e.g. in a useEffect where throw is swallowed).
 */
export function trySaveState(
  chainId: number,
  contractAddress: string,
  employer: string,
  state: StoredAppState,
): StorageWriteError | null {
  try {
    saveState(chainId, contractAddress, employer, state)
    return null
  } catch (err) {
    return err instanceof StorageWriteError ? err : new StorageWriteError(err)
  }
}

// ─── Draft helpers ──────────────────────────────────────────────────────────

export function saveDraft(
  chainId: number,
  contractAddress: string,
  employer: string,
  draft: PayrollDraft | null,
): void {
  const state = loadState(chainId, contractAddress, employer)
  saveState(chainId, contractAddress, employer, { ...state, draft })
}

export function clearDraft(
  chainId: number,
  contractAddress: string,
  employer: string,
): void {
  saveDraft(chainId, contractAddress, employer, null)
}

// ─── Run helpers ─────────────────────────────────────────────────────────────

/**
 * Upsert a run by runId.
 *
 * Immutability rules:
 * - snapshot is NEVER overwritten once set.
 * - submittedAt is NEVER overwritten.
 * - txHash is NEVER downgraded from a known value to null.
 *   (A known hash is preserved even if a patch passes null.)
 *
 * Returns StorageWriteError if the write fails; null on success.
 * Callers MUST check this before showing the wallet signing prompt.
 */
export function upsertRun(
  chainId: number,
  contractAddress: string,
  employer: string,
  run: PayrollRun,
): StorageWriteError | null {
  const state = loadState(chainId, contractAddress, employer)
  const idx = state.runs.findIndex((r) => r.runId === run.runId)
  let runs: PayrollRun[]
  if (idx >= 0) {
    const existing = state.runs[idx]
    runs = state.runs.map((r, i) =>
      i === idx
        ? {
            ...r,
            ...run,
            // Immutable fields: never overwrite
            snapshot: r.snapshot ?? run.snapshot,
            submittedAt: r.submittedAt,
            // Never downgrade a known txHash to null
            txHash: r.txHash ?? run.txHash,
          }
        : r,
    )
    // Suppress unused variable warning
    void existing
  } else {
    runs = [run, ...state.runs].slice(0, 100)
  }
  return trySaveState(chainId, contractAddress, employer, { ...state, runs })
}

/**
 * Patch specific fields on an existing run.
 * The snapshot, submittedAt, and runId fields are never overwritten.
 * txHash is never downgraded from a known value to null.
 *
 * Returns StorageWriteError if write fails; null on success.
 */
export function patchRun(
  chainId: number,
  contractAddress: string,
  employer: string,
  runId: string,
  patch: Partial<Omit<PayrollRun, 'snapshot' | 'submittedAt' | 'runId'>>,
): StorageWriteError | null {
  const state = loadState(chainId, contractAddress, employer)
  const runs = state.runs.map((r) => {
    if (r.runId !== runId) return r
    const merged = { ...r, ...patch }
    // Never downgrade txHash
    merged.txHash = r.txHash ?? patch.txHash ?? null
    return merged
  })
  return trySaveState(chainId, contractAddress, employer, { ...state, runs })
}

/**
 * Require a durable write before the wallet signing prompt.
 *
 * Usage:
 *   const writeErr = requireDurableWrite(chainId, contractAddress, employer, pendingRun)
 *   if (writeErr) { showError(writeErr.message); return } // block signing
 *   // safe to show wallet prompt now
 */
export function requireDurableWrite(
  chainId: number,
  contractAddress: string,
  employer: string,
  run: PayrollRun,
): StorageWriteError | null {
  return upsertRun(chainId, contractAddress, employer, run)
}

// Keep for backward compatibility — delegates to upsertRun
/** @deprecated Use upsertRun instead. */
export function appendRun(
  chainId: number,
  contractAddress: string,
  employer: string,
  run: PayrollRun,
): void {
  upsertRun(chainId, contractAddress, employer, run)
}

/** @deprecated Use patchRun instead. */
export function updateRun(
  chainId: number,
  contractAddress: string,
  employer: string,
  runId: string,
  patch: Partial<PayrollRun>,
): void {
  const state = loadState(chainId, contractAddress, employer)
  const runs = state.runs.map((r) => (r.runId === runId ? { ...r, ...patch, snapshot: r.snapshot } : r))
  trySaveState(chainId, contractAddress, employer, { ...state, runs })
}

// ─── Chain contract config (not employer-scoped) ────────────────────────────

export function loadChainContractConfig(chainId: number): ChainContractConfig | null {
  try {
    const raw = localStorage.getItem(chainConfigKey(chainId))
    if (!raw) return null
    return JSON.parse(raw) as ChainContractConfig
  } catch {
    return null
  }
}

export function saveChainContractConfig(cfg: ChainContractConfig): void {
  try {
    localStorage.setItem(chainConfigKey(cfg.chainId), JSON.stringify(cfg))
  } catch {
    // Chain config is advisory; non-fatal
  }
}

export function clearChainContractConfig(chainId: number): void {
  try {
    localStorage.removeItem(chainConfigKey(chainId))
  } catch {
    // silent
  }
}
