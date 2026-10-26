/**
 * Grey Payroll — shared types.
 */

/** A single payroll recipient row in the draft. */
export interface RecipientRow {
  /** Stable local key (never re-used). */
  id: string
  address: string
  /** Amount as a decimal string (e.g. "1.25"). Stored as string, never float. */
  amountStr: string
}

/** Validation state for a single recipient row. */
export interface RowValidation {
  addressError: string | null
  amountError: string | null
  /** Advisory: amount is unusually large (> 10,000 USDC). */
  amountWarning: string | null
}

/**
 * Immutable snapshot of the submission parameters captured at the moment
 * the wallet signs the transaction.  Used for receipt reconciliation: every
 * field is checked against on-chain events/receipt.
 *
 * This snapshot NEVER changes after creation — it is the ground truth for
 * what was signed, regardless of what the UI state becomes later.
 */
export interface SubmissionSnapshot {
  /** Employer address at submission time. */
  employer: string
  /** Chain ID at submission time. */
  chainId: number
  /** Contract address at submission time. */
  contractAddress: string
  /** Run ID — bytes32 hex, stable for this run. */
  runId: string
  /** Recipient addresses in submission order. */
  recipients: string[]
  /** Amounts in raw bigint-serialized string form (18 dec). */
  amounts: string[]
  /** Total raw amount as string. */
  totalAmount: string
  /** ISO timestamp when the user approved the wallet signature. */
  signedAt: string
}

/** A completed payroll run record stored in history. */
export interface PayrollRun {
  runId: string
  /** Hash from wallet submission — persisted IMMEDIATELY on wallet sign. */
  txHash: string | null
  /** Chain ID the run was submitted on. */
  chainId: number
  /** Contract address the run was executed against. */
  contractAddress: string
  /** Employer wallet address. */
  employer: string
  /** Snapshot of what was submitted — never mutated after creation. */
  snapshot: SubmissionSnapshot | null
  /** Legacy compatibility — recipients from pre-snapshot runs. */
  recipients: Array<{ address: string; amountStr: string }>
  /** ISO timestamp of local submission. */
  submittedAt: string
  /**
   * pending   — tx submitted, not yet confirmed
   * confirmed — receipt.status === 1 AND PayrollExecuted/PaymentSent events verified
   * failed    — receipt.status === 0 (reverted) OR wallet rejected
   * replaced  — tx replaced by a new hash (speed-up / cancellation)
   * unknown   — timeout or RPC error; outcome not yet determined
   */
  status: 'pending' | 'confirmed' | 'failed' | 'replaced' | 'unknown'
  /** Explorer link once txHash is known. */
  explorerUrl: string | null
  /**
   * Onchain verification result, populated after receipt + event reconciliation.
   * null = not yet verified.
   */
  verification: RunVerification | null
}

/**
 * Result of reconciling a run against onchain receipt + contract events.
 */
export interface RunVerification {
  /** ISO timestamp this verification was completed. */
  verifiedAt: string
  /** receipt.status: 1 = success, 0 = reverted. */
  receiptStatus: 0 | 1
  /** True if a PayrollExecuted event was found matching employer + runId. */
  eventFound: boolean
  /** True if PaymentSent count + amounts match the submission snapshot. */
  amountsMatch: boolean
  /** Discrepancies found during reconciliation (empty = clean). */
  discrepancies: string[]
  /** The actual total paid as reported by the PayrollExecuted event. */
  onchainTotal: string | null
  /** The final confirmed txHash (may differ from original if replaced). */
  finalTxHash: string
}

/** A draft payroll run saved in localStorage. */
export interface PayrollDraft {
  runId: string
  /** ISO timestamp this ID was generated. */
  runIdGeneratedAt: string
  rows: RecipientRow[]
  /** True when the employer has ticked the confirmation checkbox. */
  confirmed: boolean
  /** Chain this draft belongs to. */
  chainId: number
  /** Contract address this draft belongs to. */
  contractAddress: string
  /** Employer wallet address. */
  employer: string
}

/** Per-chain contract configuration. */
export interface ContractConfig {
  chainId: number
  address: string
  /** Block the contract was deployed at, for event scanning. 0 = unknown. */
  deployBlock: number
  /** True when the contract has been verified (bytecode + interface check passed). */
  verified: boolean
  /** ISO timestamp of last verification. */
  verifiedAt: string | null
}

/** App-level localStorage root for a given scope key. */
export interface StoredAppState {
  version: 3
  draft: PayrollDraft | null
  runs: PayrollRun[]
  contractConfig: ContractConfig | null
}

/** Per-chain contract address persistence (not employer-scoped). */
export interface ChainContractConfig {
  chainId: number
  contractAddress: string
  deployBlock: number
  verified: boolean
  verifiedAt: string | null
}
