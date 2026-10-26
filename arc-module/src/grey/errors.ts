/**
 * Grey Payroll — onchain error parser.
 * Converts viem/wagmi error objects to human-readable strings.
 */

export function parseContractError(err: unknown): string {
  if (!err) return 'Unknown error'
  const errObj = err as { message?: string; code?: number }
  const msg = errObj?.message ?? JSON.stringify(err)
  const lower = msg.toLowerCase()

  // User rejection
  if (lower.includes('user rejected') || lower.includes('user denied') || errObj?.code === 4001) {
    return 'Transaction cancelled.'
  }
  // Custom errors
  if (lower.includes('zerodeposit')) return 'Deposit amount must be greater than zero.'
  if (lower.includes('zerowithdrawal')) return 'Withdrawal amount must be greater than zero.'
  if (lower.includes('insufficientbalance')) return 'Insufficient contract balance. Deposit more USDC first.'
  if (lower.includes('runalreadyexecuted')) return 'This payroll run has already been executed. Use the History tab to see results.'
  if (lower.includes('emptyrecipients')) return 'Add at least one recipient.'
  if (lower.includes('topmanyrecipients') || lower.includes('toomanyrecipients')) return 'Maximum 50 recipients per run.'
    if (lower.includes('arraylengthmismatch')) return 'Recipient and amount lists have different lengths — this is a bug. Please refresh.'
  if (lower.includes('zeroamount')) return 'All recipient amounts must be greater than zero.'
  if (lower.includes('zerorecipient')) return 'Recipient addresses cannot be zero (0x000…).'
  if (lower.includes('selfpayment')) return 'The contract address cannot be a payroll recipient.'
  if (lower.includes('duplicaterecipient')) return 'Duplicate recipient address found — each recipient must appear only once.'
  if (lower.includes('zerorunid')) return 'Run ID is invalid — please refresh and try again.'
  if (lower.includes('paymentfailed')) {
    return 'A recipient transfer failed. The entire run was reverted. Check that all recipient addresses can receive native USDC on Arc.'
  }
  if (lower.includes('reentrancy')) return 'Reentrancy detected. Please try again.'

  // Generic cases
  if (lower.includes('insufficient funds') || lower.includes('exceeds balance')) {
    return 'Your wallet has insufficient USDC to cover this transaction (including gas).'
  }
  if (lower.includes('reverted')) {
    const reason = msg.match(/reason="([^"]+)"/)
    return reason ? `Transaction reverted: ${reason[1]}` : 'Transaction reverted. Check balances and recipient addresses.'
  }
  if (lower.includes('network') || lower.includes('timeout') || lower.includes('connection')) {
    return 'Network error. Check your connection and try again.'
  }

  // Truncate very long messages
  return msg.length > 120 ? msg.slice(0, 120) + '…' : msg
}
