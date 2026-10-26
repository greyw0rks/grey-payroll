import { decodeEventLog, isAddress, keccak256, type Hex } from 'viem'
import { isArcChainId } from '@grey/config/arc'
import { verifyArcTreasury } from './arc-treasury'
import { GREY_PAYROLL_ABI } from '../../../arc-module/src/grey/abi'

export class PaymentError extends Error {
  constructor(message: string, readonly status = 409) { super(message) }
}
export interface PaymentSnapshot {
  chainId: number; contractAddress: string; employerWallet: string; runId: string
  recipients: unknown; totalNative: string
}
export function paymentRecipients(snapshot: PaymentSnapshot): { address: `0x${string}`; amountNative: string }[] {
  if (!isArcChainId(snapshot.chainId) || !isAddress(snapshot.contractAddress) || !isAddress(snapshot.employerWallet) || /^0x0{40}$/i.test(snapshot.employerWallet) || !/^0x[0-9a-f]{64}$/i.test(snapshot.runId) || /^0x0{64}$/i.test(snapshot.runId) || !Array.isArray(snapshot.recipients) || !snapshot.recipients.length || snapshot.recipients.length > 50) throw new PaymentError('Payment plan is invalid.')
  const seen = new Set<string>()
  let total = 0n
  const rows = snapshot.recipients.map(item => {
    if (!item || typeof item.address !== 'string' || !isAddress(item.address) || /^0x0{40}$/i.test(item.address) || item.address.toLowerCase() === snapshot.contractAddress.toLowerCase() || typeof item.amountNative !== 'string' || !/^\d+$/.test(item.amountNative)) throw new PaymentError('Payment recipient snapshot is invalid.')
    const address = item.address.toLowerCase() as `0x${string}`
    const amount = BigInt(item.amountNative)
    if (amount <= 0n || seen.has(address)) throw new PaymentError('Payment recipient snapshot contains a duplicate or zero amount.')
    seen.add(address); total += amount
    if (total >= 2n ** 256n) throw new PaymentError('Payment total exceeds the contract limit.')
    return { address, amountNative: amount.toString() }
  })
  if (total.toString() !== snapshot.totalNative) throw new PaymentError('Payment total does not match its snapshot.')
  return rows
}

// Browser metadata is never used as proof. Every confirmation reads live RPC
// receipt/code at a canonical, finalized block and matches the frozen plan.
export async function verifyPaymentReceipt(snapshot: PaymentSnapshot, txHash: string) {
  if (!/^0x[0-9a-f]{64}$/i.test(txHash)) throw new PaymentError('Enter a valid transaction hash.', 400)
  const rows = paymentRecipients(snapshot)
  const verified = await verifyArcTreasury(snapshot.contractAddress, snapshot.chainId)
  const receipt = await verified.client.getTransactionReceipt({ hash: txHash as Hex })
  if (receipt.transactionHash.toLowerCase() !== txHash.toLowerCase()) throw new PaymentError('RPC returned a different transaction receipt. Keep the original hash.')
  if (receipt.status !== 'success') throw new PaymentError('This transaction reverted. No payment has been recorded.')
  if (receipt.blockNumber > verified.blockNumber) throw new PaymentError('The transaction is still awaiting finality. Verify the same hash again; do not send another payment.', 202)
  const [block, code] = await Promise.all([
    verified.client.getBlock({ blockNumber: receipt.blockNumber }),
    verified.client.getCode({ address: verified.address, blockNumber: receipt.blockNumber }),
  ])
  if (block.hash !== receipt.blockHash || !code || keccak256(code) !== verified.codeHash) throw new PaymentError('Receipt block or contract identity could not be verified. Keep the original plan.')
  const sameScope = (args: { employer?: string; runId?: string }) => args.employer?.toLowerCase() === snapshot.employerWallet.toLowerCase() && args.runId?.toLowerCase() === snapshot.runId.toLowerCase()
  const events = receipt.logs.filter(log => log.address.toLowerCase() === verified.address.toLowerCase()).map(log => {
    if (log.removed) throw new PaymentError('A receipt log was removed; payment remains unverified.')
    try { return decodeEventLog({ abi: GREY_PAYROLL_ABI, data: log.data, topics: log.topics, strict: true }) }
    catch { throw new PaymentError('Successful receipt contains unreadable payment evidence. Keep the original plan and verify again.') }
  })
  const executions = events.filter(event => event.eventName === 'PayrollExecuted' && sameScope(event.args))
  const transfers = events.filter(event => event.eventName === 'PaymentSent' && sameScope(event.args))
  const execution = executions[0]
  if (executions.length !== 1 || execution?.eventName !== 'PayrollExecuted' || execution.args.totalPaid.toString() !== snapshot.totalNative || execution.args.recipientCount !== BigInt(rows.length) || transfers.length !== rows.length) throw new PaymentError('Successful receipt does not match this company payment plan. Nothing was marked paid; do not resend an uncertain run.')
  for (const row of rows) {
    const matches = transfers.filter(event => event.eventName === 'PaymentSent' && event.args.recipient.toLowerCase() === row.address && event.args.amount.toString() === row.amountNative)
    if (matches.length !== 1) throw new PaymentError('Recipient amounts do not match the frozen company plan. Payment remains unverified.')
  }
  return { txHash: receipt.transactionHash.toLowerCase(), blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash, verifiedAt: new Date() }
}
