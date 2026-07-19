export const PayrollTreasuryABI = [
  {
    type: 'constructor',
    inputs: [
      { name: '_relayer', type: 'address' },
      { name: '_token', type: 'address' },
    ],
  },
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setEmployee',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'employee', type: 'address' },
      { name: 'dailyRate', type: 'uint256' },
      { name: 'workingDaysPerMonth', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'removeEmployee',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'employee', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'releaseDaily',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'employee', type: 'address' },
      { name: 'date', type: 'uint256' },
    ],
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
    name: 'emergencyWithdraw',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getBalance',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'availableBalance',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getEmployeeBuffer',
    stateMutability: 'view',
    inputs: [{ name: 'employee', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'employees',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'dailyRate', type: 'uint256' },
      { name: 'bufferAmount', type: 'uint256' },
      { name: 'active', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'released',
    stateMutability: 'view',
    inputs: [
      { name: '', type: 'address' },
      { name: '', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'totalBuffer',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'TreasuryDeposit',
    inputs: [
      { name: 'employer', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'DailyRelease',
    inputs: [
      { name: 'employee', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'date', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'EmployeeAdded',
    inputs: [
      { name: 'employee', type: 'address', indexed: true },
      { name: 'dailyRate', type: 'uint256', indexed: false },
      { name: 'bufferAmount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'EmployeeRemoved',
    inputs: [
      { name: 'employee', type: 'address', indexed: true },
      { name: 'bufferReleased', type: 'uint256', indexed: false },
    ],
  },
] as const
