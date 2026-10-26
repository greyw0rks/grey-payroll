/**
 * Grey Payroll — GreyPayroll contract ABI.
 * Derived from /home/user/app/contracts/GreyPayroll.sol
 * Native-USDC multi-employer payroll on Arc chain.
 */
export const GREY_PAYROLL_ABI = [
  // ── Events ────────────────────────────────────────────────────────────────
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      { name: 'employer', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Withdrawn',
    inputs: [
      { name: 'employer', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PayrollExecuted',
    inputs: [
      { name: 'employer', type: 'address', indexed: true },
      { name: 'runId', type: 'bytes32', indexed: true },
      { name: 'totalPaid', type: 'uint256', indexed: false },
      { name: 'recipientCount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PaymentSent',
    inputs: [
      { name: 'employer', type: 'address', indexed: true },
      { name: 'runId', type: 'bytes32', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },

  // ── Custom errors ─────────────────────────────────────────────────────────
  { type: 'error', name: 'ZeroDeposit', inputs: [] },
  { type: 'error', name: 'ZeroWithdrawal', inputs: [] },
  {
    type: 'error',
    name: 'InsufficientBalance',
    inputs: [
      { name: 'available', type: 'uint256' },
      { name: 'required', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'EmptyRecipients', inputs: [] },
  {
    type: 'error',
    name: 'ArrayLengthMismatch',
    inputs: [
      { name: 'recipientsLen', type: 'uint256' },
      { name: 'amountsLen', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'TooManyRecipients', inputs: [] },
  { type: 'error', name: 'ZeroAmount', inputs: [{ name: 'index', type: 'uint256' }] },
  { type: 'error', name: 'ZeroRecipient', inputs: [{ name: 'index', type: 'uint256' }] },
  { type: 'error', name: 'SelfPayment', inputs: [{ name: 'index', type: 'uint256' }] },
  { type: 'error', name: 'DuplicateRecipient', inputs: [{ name: 'index', type: 'uint256' }] },
  { type: 'error', name: 'ZeroRunId', inputs: [] },
  { type: 'error', name: 'RunAlreadyExecuted', inputs: [] },
  {
    type: 'error',
    name: 'PaymentFailed',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'index', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'Reentrancy', inputs: [] },

  // ── State variables (public getters) ──────────────────────────────────────
  {
    type: 'function',
    name: 'MAX_RECIPIENTS',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalDeposited',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balances',
    stateMutability: 'view',
    inputs: [{ name: 'employer', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'runExecuted',
    stateMutability: 'view',
    inputs: [
      { name: 'employer', type: 'address' },
      { name: 'runId', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },

  // ── View helpers ──────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'employer', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'hasExecuted',
    stateMutability: 'view',
    inputs: [
      { name: 'employer', type: 'address' },
      { name: 'runId', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },

  // ── Mutating functions ────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'executePayroll',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'runId', type: 'bytes32' },
      { name: 'recipients', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
    ],
    outputs: [],
  },
] as const

export type GreyPayrollAbi = typeof GREY_PAYROLL_ABI
