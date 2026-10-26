/**
 * Tests for src/grey/reconcile.ts
 *
 * Covers:
 *  - Successful match (all events correct)
 *  - Reverted receipt → definite failed
 *  - Missing PayrollExecuted → unknown (NOT failed — successful receipt)
 *  - Wrong employer → unknown
 *  - Missing PaymentSent for a recipient → unknown
 *  - Extra PaymentSent events (count > snapshot) → unknown
 *  - Duplicate PaymentSent for same recipient → unknown
 *  - Wrong PayrollExecuted totalPaid → unknown
 *  - Wrong PayrollExecuted recipientCount → unknown
 *  - Wrong runId (PayrollExecuted for different runId) → unknown
 *  - Amount mismatch between PaymentSent and snapshot → unknown
 *  - Unrelated contract logs are filtered
 *  - Fake stored confirmation: reconcile ignores stored status, uses receipt
 *  - 0.01 and 0.02 USDC amounts reconcile correctly
 *  - verificationToStatus: only reverted receipt = 'failed'; success+missing proof = 'unknown'
 */
import { describe, it, expect } from 'vitest'
import { reconcileReceipt, verificationToStatus } from '../reconcile'
import type { SubmissionSnapshot } from '../types'
import type { MinimalReceipt } from '../reconcile'
import { encodeEventTopics, encodeAbiParameters, parseAbiParameters } from 'viem'

// ─── Constants ────────────────────────────────────────────────────────────────

const CONTRACT  = '0xCB8a8E81E50dF0BeBDcE1E1b50ABa42a1B40A0c3' as `0x${string}`
const EMP       = '0xdAC17F958D2ee523a2206206994597C13D831ec7' as `0x${string}`
const RECIP_A   = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as `0x${string}`
const RECIP_B   = '0x6B175474E89094C44Da98b954EedeAC495271d0F' as `0x${string}`
const WRONG_EMP = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' as `0x${string}`
const RUN_ID    = ('0x' + 'a'.repeat(64)) as `0x${string}`
const TX_HASH   = ('0x' + 'b'.repeat(64)) as `0x${string}`

// ─── ABI fragments for event encoding ────────────────────────────────────────

const PAYROLL_EXECUTED_ABI = [{
  type: 'event' as const, name: 'PayrollExecuted',
  inputs: [
    { name: 'employer',        type: 'address', indexed: true  },
    { name: 'runId',           type: 'bytes32', indexed: true  },
    { name: 'totalPaid',       type: 'uint256', indexed: false },
    { name: 'recipientCount',  type: 'uint256', indexed: false },
  ],
}]

const PAYMENT_SENT_ABI = [{
  type: 'event' as const, name: 'PaymentSent',
  inputs: [
    { name: 'employer',   type: 'address', indexed: true  },
    { name: 'runId',      type: 'bytes32', indexed: true  },
    { name: 'recipient',  type: 'address', indexed: true  },
    { name: 'amount',     type: 'uint256', indexed: false },
  ],
}]

// ─── Log builders ─────────────────────────────────────────────────────────────

function makePayrollExecutedLog(
  employer: `0x${string}`,
  runId: `0x${string}`,
  totalPaid: bigint,
  recipientCount: bigint,
  contractAddr: `0x${string}` = CONTRACT,
): MinimalReceipt['logs'][0] {
  const topics = encodeEventTopics({
    abi: PAYROLL_EXECUTED_ABI, eventName: 'PayrollExecuted',
    args: { employer, runId },
  }) as `0x${string}`[]
  const data = encodeAbiParameters(
    parseAbiParameters('uint256, uint256'),
    [totalPaid, recipientCount],
  )
  return { address: contractAddr, topics, data }
}

function makePaymentSentLog(
  employer: `0x${string}`,
  runId: `0x${string}`,
  recipient: `0x${string}`,
  amount: bigint,
  contractAddr: `0x${string}` = CONTRACT,
): MinimalReceipt['logs'][0] {
  const topics = encodeEventTopics({
    abi: PAYMENT_SENT_ABI, eventName: 'PaymentSent',
    args: { employer, runId, recipient },
  }) as `0x${string}`[]
  const data = encodeAbiParameters(parseAbiParameters('uint256'), [amount])
  return { address: contractAddr, topics, data }
}

// ─── Snapshot / receipt helpers ───────────────────────────────────────────────

function makeSnapshot(
  recipients: string[] = [RECIP_A],
  amounts: string[]    = ['1000000000000000000'],
): SubmissionSnapshot {
  return {
    employer: EMP,
    chainId: 5042002,
    contractAddress: CONTRACT,
    runId: RUN_ID,
    recipients,
    amounts,
    totalAmount: amounts.map(BigInt).reduce((a, b) => a + b, 0n).toString(),
    signedAt: new Date().toISOString(),
  }
}

/** Receipt with correct single-recipient logs. */
function makeSuccessReceipt(
  extraLogs: MinimalReceipt['logs'] = [],
): MinimalReceipt {
  return {
    status: 'success',
    transactionHash: TX_HASH,
    logs: [
      makePayrollExecutedLog(EMP, RUN_ID, 1_000_000_000_000_000_000n, 1n),
      makePaymentSentLog(EMP, RUN_ID, RECIP_A, 1_000_000_000_000_000_000n),
      ...extraLogs,
    ],
  }
}

// ─── Successful match ─────────────────────────────────────────────────────────

describe('reconcileReceipt — successful match', () => {
  it('returns confirmed when receipt=success and all events match', () => {
    const v = reconcileReceipt(makeSuccessReceipt(), makeSnapshot(), CONTRACT)
    expect(v.receiptStatus).toBe(1)
    expect(v.eventFound).toBe(true)
    expect(v.amountsMatch).toBe(true)
    expect(v.discrepancies).toHaveLength(0)
    expect(verificationToStatus(v)).toBe('confirmed')
  })

  it('sets onchainTotal from PayrollExecuted event', () => {
    const v = reconcileReceipt(makeSuccessReceipt(), makeSnapshot(), CONTRACT)
    expect(v.onchainTotal).toBe('1000000000000000000')
  })

  it('two recipients, both matching', () => {
    const snap = makeSnapshot(
      [RECIP_A, RECIP_B],
      ['1000000000000000000', '2000000000000000000'],
    )
    const receipt: MinimalReceipt = {
      status: 'success', transactionHash: TX_HASH,
      logs: [
        makePayrollExecutedLog(EMP, RUN_ID, 3_000_000_000_000_000_000n, 2n),
        makePaymentSentLog(EMP, RUN_ID, RECIP_A, 1_000_000_000_000_000_000n),
        makePaymentSentLog(EMP, RUN_ID, RECIP_B, 2_000_000_000_000_000_000n),
      ],
    }
    const v = reconcileReceipt(receipt, snap, CONTRACT)
    expect(v.amountsMatch).toBe(true)
    expect(v.discrepancies).toHaveLength(0)
    expect(verificationToStatus(v)).toBe('confirmed')
  })

  it('0.01 and 0.02 USDC amounts reconcile correctly (not raw wei confusion)', () => {
    // 0.01 USDC = 10_000_000_000_000_000 wei (18-dec)
    // 0.02 USDC = 20_000_000_000_000_000 wei (18-dec)
    const amount01 = 10_000_000_000_000_000n
    const amount02 = 20_000_000_000_000_000n
    const snap = makeSnapshot(
      [RECIP_A, RECIP_B],
      [amount01.toString(), amount02.toString()],
    )
    const receipt: MinimalReceipt = {
      status: 'success', transactionHash: TX_HASH,
      logs: [
        makePayrollExecutedLog(EMP, RUN_ID, amount01 + amount02, 2n),
        makePaymentSentLog(EMP, RUN_ID, RECIP_A, amount01),
        makePaymentSentLog(EMP, RUN_ID, RECIP_B, amount02),
      ],
    }
    const v = reconcileReceipt(receipt, snap, CONTRACT)
    expect(v.amountsMatch).toBe(true)
    expect(v.discrepancies).toHaveLength(0)
    expect(verificationToStatus(v)).toBe('confirmed')
  })
})

// ─── Reverted receipt — definite failure ──────────────────────────────────────

describe('reconcileReceipt — reverted receipt', () => {
  it('returns FAILED when receipt.status=reverted', () => {
    const receipt: MinimalReceipt = { status: 'reverted', transactionHash: TX_HASH, logs: [] }
    const v = reconcileReceipt(receipt, makeSnapshot(), CONTRACT)
    expect(v.receiptStatus).toBe(0)
    expect(v.eventFound).toBe(false)
    expect(v.amountsMatch).toBe(false)
    expect(v.discrepancies[0]).toContain('reverted')
    expect(verificationToStatus(v)).toBe('failed')
  })
})

// ─── Success receipt + missing/wrong events → UNKNOWN (never failed) ──────────

describe('reconcileReceipt — missing PayrollExecuted (success receipt) → unknown', () => {
  it('returns UNKNOWN (not failed) when PayrollExecuted is absent in a success receipt', () => {
    // Only a PaymentSent, no PayrollExecuted — event was somehow missing.
    // The receipt succeeded; we cannot say payroll did not run.
    const receipt: MinimalReceipt = {
      status: 'success', transactionHash: TX_HASH,
      logs: [makePaymentSentLog(EMP, RUN_ID, RECIP_A, 1_000_000_000_000_000_000n)],
    }
    const v = reconcileReceipt(receipt, makeSnapshot(), CONTRACT)
    expect(v.eventFound).toBe(false)
    expect(verificationToStatus(v)).toBe('unknown')   // NOT 'failed'
  })
})

describe('reconcileReceipt — wrong employer (success receipt) → unknown', () => {
  it('returns UNKNOWN when PayrollExecuted belongs to a different employer', () => {
    const receipt: MinimalReceipt = {
      status: 'success', transactionHash: TX_HASH,
      logs: [
        makePayrollExecutedLog(WRONG_EMP, RUN_ID, 1_000_000_000_000_000_000n, 1n),
        makePaymentSentLog(WRONG_EMP, RUN_ID, RECIP_A, 1_000_000_000_000_000_000n),
      ],
    }
    const v = reconcileReceipt(receipt, makeSnapshot(), CONTRACT)
    expect(v.eventFound).toBe(false)
    expect(verificationToStatus(v)).toBe('unknown')   // NOT 'failed'
  })
})

describe('reconcileReceipt — missing PaymentSent (success receipt) → unknown', () => {
  it('returns UNKNOWN when PaymentSent is absent for a recipient', () => {
    // PayrollExecuted present but no PaymentSent for recipient.
    const receipt: MinimalReceipt = {
      status: 'success', transactionHash: TX_HASH,
      logs: [makePayrollExecutedLog(EMP, RUN_ID, 1_000_000_000_000_000_000n, 1n)],
    }
    const v = reconcileReceipt(receipt, makeSnapshot(), CONTRACT)
    expect(v.amountsMatch).toBe(false)
    expect(v.discrepancies.some((d) => d.includes('Missing PaymentSent'))).toBe(true)
    expect(verificationToStatus(v)).toBe('unknown')   // NOT 'failed'
  })
})

// ─── Wrong PayrollExecuted.totalPaid → unknown ────────────────────────────────

describe('reconcileReceipt — wrong PayrollExecuted totalPaid → unknown', () => {
  it('returns UNKNOWN when totalPaid in event ≠ sum(snapshot.amounts)', () => {
    const receipt: MinimalReceipt = {
      status: 'success', transactionHash: TX_HASH,
      logs: [
        // totalPaid is 2e18 but snapshot says 1e18
        makePayrollExecutedLog(EMP, RUN_ID, 2_000_000_000_000_000_000n, 1n),
        makePaymentSentLog(EMP, RUN_ID, RECIP_A, 1_000_000_000_000_000_000n),
      ],
    }
    const v = reconcileReceipt(receipt, makeSnapshot(), CONTRACT)
    expect(v.discrepancies.some((d) => d.includes('totalPaid'))).toBe(true)
    expect(verificationToStatus(v)).toBe('unknown')   // NOT 'failed'
  })
})

// ─── Wrong PayrollExecuted.recipientCount → unknown ──────────────────────────

describe('reconcileReceipt — wrong PayrollExecuted recipientCount → unknown', () => {
  it('returns UNKNOWN when recipientCount in event ≠ snapshot.recipients.length', () => {
    const receipt: MinimalReceipt = {
      status: 'success', transactionHash: TX_HASH,
      logs: [
        // recipientCount is 2 but snapshot has 1 recipient
        makePayrollExecutedLog(EMP, RUN_ID, 1_000_000_000_000_000_000n, 2n),
        makePaymentSentLog(EMP, RUN_ID, RECIP_A, 1_000_000_000_000_000_000n),
      ],
    }
    const v = reconcileReceipt(receipt, makeSnapshot(), CONTRACT)
    expect(v.discrepancies.some((d) => d.includes('recipientCount'))).toBe(true)
    expect(verificationToStatus(v)).toBe('unknown')   // NOT 'failed'
  })
})

// ─── Duplicate PaymentSent for same recipient → unknown ───────────────────────

describe('reconcileReceipt — duplicate PaymentSent → unknown', () => {
  it('returns UNKNOWN when two PaymentSent events have the same recipient', () => {
    // Two PaymentSent logs for RECIP_A in the same run — duplicate.
    const receipt: MinimalReceipt = {
      status: 'success', transactionHash: TX_HASH,
      logs: [
        makePayrollExecutedLog(EMP, RUN_ID, 2_000_000_000_000_000_000n, 1n),
        makePaymentSentLog(EMP, RUN_ID, RECIP_A, 1_000_000_000_000_000_000n),
        makePaymentSentLog(EMP, RUN_ID, RECIP_A, 1_000_000_000_000_000_000n), // duplicate
      ],
    }
    const v = reconcileReceipt(receipt, makeSnapshot(), CONTRACT)
    expect(v.amountsMatch).toBe(false)
    expect(v.discrepancies.some((d) => d.toLowerCase().includes('duplicate'))).toBe(true)
    expect(verificationToStatus(v)).toBe('unknown')   // NOT 'failed'
  })
})

// ─── Extra PaymentSent (count > snapshot) → unknown ──────────────────────────

describe('reconcileReceipt — extra PaymentSent → unknown', () => {
  it('returns UNKNOWN when PaymentSent count > snapshot recipients', () => {
    // Snapshot has 1 recipient but 2 different PaymentSent events found.
    const receipt: MinimalReceipt = {
      status: 'success', transactionHash: TX_HASH,
      logs: [
        makePayrollExecutedLog(EMP, RUN_ID, 2_000_000_000_000_000_000n, 2n),
        makePaymentSentLog(EMP, RUN_ID, RECIP_A, 1_000_000_000_000_000_000n),
        makePaymentSentLog(EMP, RUN_ID, RECIP_B, 1_000_000_000_000_000_000n),
      ],
    }
    const v = reconcileReceipt(receipt, makeSnapshot(), CONTRACT)  // snapshot has only RECIP_A
    expect(v.amountsMatch).toBe(false)
    expect(v.discrepancies.some((d) => d.includes('count') || d.includes('Extra'))).toBe(true)
    expect(verificationToStatus(v)).toBe('unknown')   // NOT 'failed'
  })
})

// ─── Wrong runId → unknown ────────────────────────────────────────────────────

describe('reconcileReceipt — wrong runId (success receipt) → unknown', () => {
  it('returns UNKNOWN when PayrollExecuted has a different runId', () => {
    const wrongRunId = ('0x' + 'f'.repeat(64)) as `0x${string}`
    const receipt: MinimalReceipt = {
      status: 'success', transactionHash: TX_HASH,
      logs: [makePayrollExecutedLog(EMP, wrongRunId, 1_000_000_000_000_000_000n, 1n)],
    }
    const v = reconcileReceipt(receipt, makeSnapshot(), CONTRACT)
    expect(v.eventFound).toBe(false)
    expect(verificationToStatus(v)).toBe('unknown')   // NOT 'failed'
  })
})

// ─── Amount mismatch → unknown ────────────────────────────────────────────────

describe('reconcileReceipt — amount mismatch (success receipt) → unknown', () => {
  it('returns UNKNOWN when onchain PaymentSent amount ≠ snapshot amount', () => {
    const receipt: MinimalReceipt = {
      status: 'success', transactionHash: TX_HASH,
      logs: [
        makePayrollExecutedLog(EMP, RUN_ID, 2_000_000_000_000_000_000n, 1n),
        // Amount sent was 2e18 but snapshot says 1e18
        makePaymentSentLog(EMP, RUN_ID, RECIP_A, 2_000_000_000_000_000_000n),
      ],
    }
    const v = reconcileReceipt(receipt, makeSnapshot(), CONTRACT)
    expect(v.amountsMatch).toBe(false)
    expect(v.discrepancies.some((d) => d.includes('mismatch'))).toBe(true)
    expect(verificationToStatus(v)).toBe('unknown')   // NOT 'failed'
  })
})

// ─── Unrelated contract logs are filtered ────────────────────────────────────

describe('reconcileReceipt — unrelated contract logs filtered', () => {
  it('ignores PaymentSent logs from a different contract address', () => {
    const WRONG_CONTRACT = '0xbadc0ntract000000000000000000000000000001' as `0x${string}`
    const receipt: MinimalReceipt = {
      status: 'success', transactionHash: TX_HASH,
      logs: [
        makePayrollExecutedLog(EMP, RUN_ID, 1_000_000_000_000_000_000n, 1n), // correct contract
        makePaymentSentLog(EMP, RUN_ID, RECIP_A, 1_000_000_000_000_000_000n, WRONG_CONTRACT), // wrong contract
      ],
    }
    const v = reconcileReceipt(receipt, makeSnapshot(), CONTRACT)
    expect(v.amountsMatch).toBe(false)
    expect(v.discrepancies.some((d) => d.includes('Missing PaymentSent'))).toBe(true)
    expect(verificationToStatus(v)).toBe('unknown')
  })
})

// ─── verificationToStatus semantics ──────────────────────────────────────────

describe('verificationToStatus — semantics', () => {
  const base = {
    verifiedAt:     new Date().toISOString(),
    receiptStatus:  1 as const,
    eventFound:     true,
    amountsMatch:   true,
    discrepancies:  [] as string[],
    onchainTotal:   '1000000000000000000',
    finalTxHash:    TX_HASH,
  }

  it('confirmed only when all conditions hold (status=1, eventFound, amountsMatch, no discrepancies)', () => {
    expect(verificationToStatus(base)).toBe('confirmed')
  })

  it('failed only for status=0 (reverted receipt)', () => {
    expect(verificationToStatus({ ...base, receiptStatus: 0 as const })).toBe('failed')
  })

  it('unknown (NOT failed) when status=1 but eventFound=false', () => {
    expect(verificationToStatus({ ...base, eventFound: false })).toBe('unknown')
  })

  it('unknown (NOT failed) when status=1 but amountsMatch=false', () => {
    expect(verificationToStatus({ ...base, amountsMatch: false })).toBe('unknown')
  })

  it('unknown (NOT failed) when status=1 but discrepancies are non-empty', () => {
    expect(verificationToStatus({ ...base, discrepancies: ['wrong total'] })).toBe('unknown')
  })

  it('unknown (NOT failed) when status=1, eventFound=false, amountsMatch=false', () => {
    expect(verificationToStatus({ ...base, eventFound: false, amountsMatch: false })).toBe('unknown')
  })
})

// ─── Fake stored confirmation not trusted ────────────────────────────────────

describe('fake stored confirmation not trusted by reconcileReceipt', () => {
  it('a run with stored status=confirmed but reverted receipt returns failed from reconcile', () => {
    // Simulates a race where local storage says confirmed but chain says reverted.
    // reconcileReceipt always reads the receipt directly — not the stored status.
    const receipt: MinimalReceipt = { status: 'reverted', transactionHash: TX_HASH, logs: [] }
    const v = reconcileReceipt(receipt, makeSnapshot(), CONTRACT)
    expect(verificationToStatus(v)).toBe('failed')
    expect(v.receiptStatus).toBe(0)
  })

  it('a run with stored status=confirmed but missing events returns unknown', () => {
    // Simulates a stored confirmed but the RPC returned logs with no matching events.
    const receipt: MinimalReceipt = {
      status: 'success', transactionHash: TX_HASH,
      logs: [], // no events at all — RPC issue or log pruning
    }
    const v = reconcileReceipt(receipt, makeSnapshot(), CONTRACT)
    expect(verificationToStatus(v)).toBe('unknown')   // NOT confirmed, NOT failed
  })
})
