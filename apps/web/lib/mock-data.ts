const fmt = (n: number, d = 0) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
export const naira = (n: number) => `₦${fmt(n)}`

export const STAFF = [
  { name: 'Amaka Eze',       role: 'Backend Engineer',   start: 'Jan 12, 2025', salary: 580000, status: 'Active',   wallet: '0x71C9...4eAa', avatar: 'AE' },
  { name: 'Tunde Bakare',    role: 'Product Designer',   start: 'Mar 03, 2025', salary: 420000, status: 'Active',   wallet: '0x9F2b...c011', avatar: 'TB' },
  { name: 'Chidinma Okoro',  role: 'HR Manager',         start: 'Nov 18, 2024', salary: 350000, status: 'Active',   wallet: '0x3aD4...77f2', avatar: 'CO' },
  { name: 'Femi Adeyemi',    role: 'Sales Lead',         start: 'Feb 21, 2025', salary: 480000, status: 'On Leave', wallet: '0x88e1...90Bc', avatar: 'FA' },
  { name: 'Ngozi Umeh',      role: 'Frontend Engineer',  start: 'May 09, 2025', salary: 540000, status: 'Active',   wallet: '0x12Fa...d34E', avatar: 'NU' },
  { name: 'Kunle Salako',    role: 'Contract — DevOps',  start: 'Apr 14, 2025', salary: 300000, status: 'Flagged',  wallet: '0x55Cb...1A9d', avatar: 'KS' },
]

export const PAYROLL = [
  { emp: 'Amaka Eze',       date: 'Jun 19, 2026', type: 'Daily Release', amount: 26364, tx: '0x4e21...88ac' },
  { emp: 'Tunde Bakare',    date: 'Jun 19, 2026', type: 'Daily Release', amount: 19091, tx: '0x7bd0...12fe' },
  { emp: 'Ngozi Umeh',      date: 'Jun 19, 2026', type: 'Daily Release', amount: 24545, tx: '0x9a33...c701' },
  { emp: 'Chidinma Okoro',  date: 'Jun 18, 2026', type: 'Daily Release', amount: 15909, tx: '0x10ef...4d9b' },
  { emp: 'Femi Adeyemi',    date: 'Jun 18, 2026', type: 'Refund Payout', amount: 18500, tx: '0x66aa...0921' },
]

export const REQUESTS = [
  { type: 'Refund',  emp: 'Tunde Bakare',   detail: 'Figma annual subscription — Software', amount: 18500, status: 'Pending',  avatar: 'TB' },
  { type: 'Leave',   emp: 'Femi Adeyemi',   detail: 'Annual leave — Jun 24 to Jun 28',       amount: null,  status: 'Pending',  avatar: 'FA' },
  { type: 'Advance', emp: 'Kunle Salako',   detail: 'Salary advance — generator repair',     amount: 90000, status: 'Pending',  avatar: 'KS' },
  { type: 'Refund',  emp: 'Ngozi Umeh',     detail: 'Client dinner — Meals',                 amount: 32000, status: 'Approved', avatar: 'NU' },
]

export const REVENUE = [62, 58, 71, 66, 74, 69, 77, 73, 80, 76, 84, 79]

export const employee = {
  name:             'Amaka Eze',
  initials:         'AE',
  role:             'Backend Engineer',
  company:          'Lagos Studio Collective',
  walletAddress:    '0x71C9...4eAa',
  monthlySalary:    580000,
  dailyRate:        26364,
  daysChecked:      13,
  workingDays:      22,
  earnedThisMonth:  343636,
  nextPayout:       26364,
  walletBalance:    662.8,
  walletBalanceNgn: 1089400,
}

export const EMPLOYEE_REQUESTS = [
  { type: 'Refund',  detail: 'Figma subscription',         amount: 18500, status: 'Pending'  },
  { type: 'Advance', detail: 'Salary advance request',      amount: 90000, status: 'Approved' },
  { type: 'Refund',  detail: 'Client transport — Lagos',    amount:  7500, status: 'Rejected' },
]
