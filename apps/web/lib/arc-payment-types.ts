export interface PaymentSource {
  id: string
  kind: 'SALARY' | 'REFUND'
  employeeId: string
  name: string
  recipient: string
  amountBusiness: string
  description: string
}
export interface CompanyPaymentPlan {
  id: string
  companyId: string
  chainId: number
  contractAddress: string
  employerWallet: string
  runId: string
  status: 'PREPARED' | 'CONFIRMED'
  createdAt: string
  txHash: string | null
  submittedTxHash: string | null
  verifiedAt: string | null
  recipients: { address: string; amountNative: string; amountStr: string }[]
  totalNative: string
  items: PaymentSource[]
}
