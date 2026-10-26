/**
 * Grey Payroll — receipt and event reconciliation.
 *
 * After a transaction is included, isSuccess only means a receipt was obtained.
 * This module performs explicit reconciliation:
 *
 *  1. Verify receipt.status === 'success' (not reverted).
 *     - Reverted = definite failed.
 *     - Success + missing/mismatched proof = unverified (unknown), NOT failed.
 *       The employer cannot be told "payroll did not run" when the receipt
 *       succeeded but the event parsing failed (RPC issue, log truncation, etc.)
 *
 *  2. Find the PayrollExecuted event matching employer + runId from THIS contract.
 *
 *  3. Validate PayrollExecuted.totalPaid == sum(snapshot.amounts) exactly.
 *
 *  4. Validate PayrollExecuted.recipientCount == snapshot.recipients.length exactly.
 *
 *  5. Find ALL PaymentSent events for this employer+runId from THIS contract.
 *     Reject duplicate PaymentSent logs (same recipient twice): that would be
 *     more events than expected and cannot match a deduplicated Map.
 *     A single Map entry per recipient means a second log for the same
 *     recipient is detected as "extra PaymentSent count > snapshot count".
 *
 *  6. Verify each snapshot recipient received the exact snapshot amount.
 *
 *  7. Return RunVerification with outcome:
 *     - receiptStatus=1, eventFound, amountsMatch → verificationToStatus = 'confirmed'
 *     - receiptStatus=0 → verificationToStatus = 'failed' (definite)
 *     - receiptStatus=1 but eventFound=false or amountsMatch=false
 *       → verificationToStatus = 'unknown' (not definite failure)
 */
import { decodeEventLog, type Hex } from 'viem'
import { GREY_PAYROLL_ABI } from './abi'
import type { SubmissionSnapshot, RunVerification } from './types'

/** Minimal receipt shape. */
export interface MinimalReceipt {
  status: 'success' | 'reverted'
  transactionHash: Hex
  logs: Array<{
    address: Hex
    topics: readonly Hex[]
    data: Hex
  }>
}

/**
 * Reconcile a confirmed receipt against the submission snapshot.
 * See module header for outcome semantics.
 */
export function reconcileReceipt(
  receipt: MinimalReceipt,
  snapshot: SubmissionSnapshot,
  contractAddress: string,
): RunVerification {
  const verifiedAt = new Date().toISOString()
  const finalTxHash = receipt.transactionHash
  const discrepancies: string[] = []

  // Step 1 — receipt status
  const receiptStatus = receipt.status === 'success' ? (1 as const) : (0 as const)
  if (receiptStatus !== 1) {
    discrepancies.push('Transaction reverted (receipt.status = 0). Payroll was NOT executed.')
    return {
      verifiedAt, receiptStatus, eventFound: false,
      amountsMatch: false, discrepancies, onchainTotal: null, finalTxHash,
    }
  }

  // Step 2 — find PayrollExecuted event
  const contractLower = contractAddress.toLowerCase()
  let payrollExecutedLog: { totalPaid: bigint; recipientCount: bigint } | null = null

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contractLower) continue
    try {
      const decoded = decodeEventLog({
        abi: GREY_PAYROLL_ABI,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
        strict: false,
      })
      if (decoded.eventName !== 'PayrollExecuted') continue
      const args = decoded.args as {
        employer: string; runId: Hex; totalPaid: bigint; recipientCount: bigint
      }
      if (args.employer.toLowerCase() !== snapshot.employer.toLowerCase()) continue
      if (args.runId.toLowerCase() !== snapshot.runId.toLowerCase()) continue
      payrollExecutedLog = { totalPaid: args.totalPaid, recipientCount: args.recipientCount }
      break
    } catch { /* skip unparseable log */ }
  }

  if (!payrollExecutedLog) {
    discrepancies.push(
      `No PayrollExecuted event found for employer ${snapshot.employer} and runId ${snapshot.runId}.`,
    )
    // Success receipt but missing event = unverified/unknown, not definite failure.
    return {
      verifiedAt, receiptStatus,
      eventFound: false, amountsMatch: false,
      discrepancies, onchainTotal: null, finalTxHash,
    }
  }

  // Step 3 — validate PayrollExecuted.totalPaid == sum(snapshot.amounts)
  let snapshotTotal = 0n
  try {
    for (const a of snapshot.amounts) snapshotTotal += BigInt(a)
  } catch {
    discrepancies.push('Could not compute snapshot total — malformed amounts.')
  }
  if (payrollExecutedLog.totalPaid !== snapshotTotal) {
    discrepancies.push(
      `PayrollExecuted.totalPaid ${payrollExecutedLog.totalPaid} ≠ snapshot total ${snapshotTotal}.`,
    )
  }

  // Step 4 — validate PayrollExecuted.recipientCount == snapshot.recipients.length
  const expectedCount = BigInt(snapshot.recipients.length)
  if (payrollExecutedLog.recipientCount !== expectedCount) {
    discrepancies.push(
      `PayrollExecuted.recipientCount ${payrollExecutedLog.recipientCount} ≠ snapshot count ${expectedCount}.`,
    )
  }

  // Step 5 — collect PaymentSent events; reject duplicates
  // Map from recipient.lower → amount; a second entry for the same key means a
  // duplicate was received (contract cannot emit two PaymentSent for the same
  // recipient in a single run due to its duplicate-recipient guard, but we
  // verify explicitly anyway).
  const paymentsSent = new Map<string, bigint>()
  let duplicateFound = false

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== contractLower) continue
    try {
      const decoded = decodeEventLog({
        abi: GREY_PAYROLL_ABI,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
        strict: false,
      })
      if (decoded.eventName !== 'PaymentSent') continue
      const args = decoded.args as {
        employer: string; runId: Hex; recipient: string; amount: bigint
      }
      if (args.employer.toLowerCase() !== snapshot.employer.toLowerCase()) continue
      if (args.runId.toLowerCase() !== snapshot.runId.toLowerCase()) continue
      const recipientKey = args.recipient.toLowerCase()
      if (paymentsSent.has(recipientKey)) {
        duplicateFound = true
        discrepancies.push(
          `Duplicate PaymentSent for recipient ${args.recipient} — cannot reconcile.`,
        )
      } else {
        paymentsSent.set(recipientKey, args.amount)
      }
    } catch { /* skip */ }
  }

  // Step 6 — reconcile against snapshot
  let amountsMatch = !duplicateFound

  for (let i = 0; i < snapshot.recipients.length; i++) {
    const expectedRecipient = snapshot.recipients[i].toLowerCase()
    const expectedAmount = BigInt(snapshot.amounts[i])
    const onchainAmount = paymentsSent.get(expectedRecipient)

    if (onchainAmount === undefined) {
      amountsMatch = false
      discrepancies.push(`Missing PaymentSent for recipient ${snapshot.recipients[i]} (index ${i}).`)
    } else if (onchainAmount !== expectedAmount) {
      amountsMatch = false
      discrepancies.push(
        `Amount mismatch for recipient ${snapshot.recipients[i]}: ` +
        `expected ${expectedAmount}, onchain ${onchainAmount}.`,
      )
    }
  }

  // Extra payments: paymentsSent.size > snapshot.recipients.length means
  // logs we did not expect (different employer/runId logs filtered above, but
  // extra logs for THIS employer+runId indicate an unexpected send).
  if (paymentsSent.size > snapshot.recipients.length) {
    discrepancies.push(
      `Extra PaymentSent events: ${paymentsSent.size} found, expected ${snapshot.recipients.length}.`,
    )
    amountsMatch = false
  }
  // Under-count is caught by the missing-per-recipient loop above; also add summary.
  if (!duplicateFound && paymentsSent.size < snapshot.recipients.length) {
    discrepancies.push(
      `Fewer PaymentSent events than expected: ${paymentsSent.size} found, expected ${snapshot.recipients.length}.`,
    )
    amountsMatch = false
  }

  return {
    verifiedAt,
    receiptStatus,
    eventFound: payrollExecutedLog !== null,
    amountsMatch,
    discrepancies,
    onchainTotal: payrollExecutedLog.totalPaid.toString(),
    finalTxHash,
  }
}

/**
 * Derive a run status from a RunVerification result.
 *
 * - 'confirmed': receipt status=1 AND PayrollExecuted event found AND all
 *                PaymentSent events match the snapshot exactly.
 * - 'failed':    receipt status=0 (definite revert). Only a confirmed
 *                reverted receipt is definite failure — never a missing event.
 * - 'unknown':   receipt status=1 but event proof is missing or mismatched.
 *                A successful receipt with unresolvable event data cannot be
 *                declared failed — the payroll may have executed and the RPC
 *                may have returned truncated logs. Remains unknown until
 *                proof is obtained.
 *
 * CRITICAL: do NOT return 'failed' when receiptStatus=1 and events are absent
 * or mismatched. That would falsely tell the employer the payroll did not run
 * when it may have. Only a status=0 (reverted) receipt is definite failure.
 */
export function verificationToStatus(
  v: RunVerification,
): 'confirmed' | 'failed' | 'unknown' {
  // Only a reverted receipt is a definite failure.
  if (v.receiptStatus === 0) return 'failed'
  // All checks pass = confirmed.
  if (v.receiptStatus === 1 && v.eventFound && v.amountsMatch && v.discrepancies.length === 0) {
    return 'confirmed'
  }
  // Successful receipt but incomplete/mismatched proof = unknown.
  // This includes: missing event, wrong total, wrong count, duplicate events,
  // amount mismatches, or any other discrepancy. Do not declare failed.
  return 'unknown'
}
