/**
 * Grey Payroll — money utilities.
 *
 * Arc native USDC is 18 decimals. All contract values use this unit.
 * This file NEVER uses Number, parseFloat, or floating-point arithmetic on
 * amount strings. All parsing and formatting use BigInt arithmetic exclusively.
 *
 * Key guarantees:
 * - parseNativeUsdc returns null for scientific notation, negative values,
 *   values with > 18 decimal places, and values exceeding uint256 max.
 * - formatNativeUsdc never truncates sub-wei amounts to zero: one wei is
 *   rendered as "0.000000000000000001" (18 decimal places), not "0.00".
 * - sumAmounts checks that the result does not overflow uint256.
 * - No rounding is applied anywhere; exact representation is preserved.
 */

/** Arc native USDC decimal count. */
export const NATIVE_USDC_DECIMALS = 18

/**
 * Maximum uint256 value — the Solidity type cap.
 * Any parsed amount above this is rejected as invalid.
 */
export const UINT256_MAX = (1n << 256n) - 1n

/**
 * Parse a human-readable decimal string (e.g. "1.25") into a raw bigint
 * (18 decimals, i.e. multiply by 10^18).  Returns null on invalid input.
 *
 * Rules:
 * - Maximum 18 decimal places.
 * - No negative, non-finite, or scientific-notation values.
 * - Empty or blank strings are invalid.
 * - Zero is allowed (but amounts of exactly 0 are rejected by the contract).
 * - Values exceeding uint256 max are rejected.
 */
export function parseNativeUsdc(value: string): bigint | null {
  const s = value.trim()
  if (!s) return null
  // Reject scientific notation, negatives, and any non-decimal characters.
  if (!/^\d+(\.\d+)?$/.test(s)) return null

  const dotIndex = s.indexOf('.')
  let whole: string
  let frac: string

  if (dotIndex === -1) {
    whole = s
    frac = ''
  } else {
    whole = s.slice(0, dotIndex)
    frac = s.slice(dotIndex + 1)
  }

  if (frac.length > NATIVE_USDC_DECIMALS) return null // too many decimals

  const paddedFrac = frac.padEnd(NATIVE_USDC_DECIMALS, '0')
  // BigInt() throws on empty string; guard here
  const wholePart = whole === '' ? 0n : BigInt(whole)
  const fracPart = paddedFrac === '' ? 0n : BigInt(paddedFrac)

  const result = wholePart * 10n ** BigInt(NATIVE_USDC_DECIMALS) + fracPart

  // Reject values exceeding uint256 max
  if (result > UINT256_MAX) return null

  return result
}

/**
 * Format a raw bigint (18 decimals) to a readable string.
 *
 * Unlike the previous version, this does NOT truncate sub-precision values
 * to zero. The `places` parameter controls how many decimals are SHOWN, but
 * if all the significant digits lie beyond `places`, the function extends
 * to show the minimum number of places needed (up to 18) to avoid hiding value.
 *
 * Examples:
 *   formatNativeUsdc(1n)                   → "0.000000000000000001"  (1 wei)
 *   formatNativeUsdc(1_000_000_000_000n)   → "0.000001"              (1 μUSDC, 6-dec ERC-20 unit)
 *   formatNativeUsdc(1_250_000_000_000_000_000n) → "1.25"
 *   formatNativeUsdc(0n)                   → "0"
 *
 * @param raw    Raw bigint in 18-decimal representation.
 * @param places Minimum decimal places to show (default 2). Extended if needed.
 */
export function formatNativeUsdc(raw: bigint, places = 2): string {
  if (raw === 0n) return '0'
  if (raw < 0n) return '−' + formatNativeUsdc(-raw, places)

  const divisor = 10n ** BigInt(NATIVE_USDC_DECIMALS)
  const whole = raw / divisor
  const fracRaw = raw % divisor

  if (fracRaw === 0n) return whole.toString()

  // Full 18-digit fractional string, zero-padded on left
  const fullFrac = fracRaw.toString().padStart(NATIVE_USDC_DECIMALS, '0')

  // Find the last non-zero digit position (1-based index)
  let lastNonZero = NATIVE_USDC_DECIMALS
  while (lastNonZero > 0 && fullFrac[lastNonZero - 1] === '0') lastNonZero--

  // Show at least `places` decimal places, but extend to lastNonZero if needed
  const show = Math.max(places, lastNonZero)
  const displayFrac = fullFrac.slice(0, show)

  return `${whole}.${displayFrac}`
}

/**
 * Format to a fixed number of decimal places (for tabular display).
 * Like formatNativeUsdc but always shows exactly `places` digits.
 * Still does not truncate sub-places amounts to zero — if raw < 10^(18-places)
 * the value is shown in full scientific decimal form.
 */
export function formatNativeUsdcFixed(raw: bigint, places = 6): string {
  if (raw === 0n) return `0.${'0'.repeat(places)}`
  if (raw < 0n) return '−' + formatNativeUsdcFixed(-raw, places)

  const divisor = 10n ** BigInt(NATIVE_USDC_DECIMALS)
  const whole = raw / divisor
  const fracRaw = raw % divisor

  if (fracRaw === 0n) return `${whole}.${'0'.repeat(places)}`

  const fullFrac = fracRaw.toString().padStart(NATIVE_USDC_DECIMALS, '0')
  // Find last non-zero
  let lastNonZero = NATIVE_USDC_DECIMALS
  while (lastNonZero > 0 && fullFrac[lastNonZero - 1] === '0') lastNonZero--

  const show = Math.max(places, lastNonZero)
  const truncated = fullFrac.slice(0, show).padEnd(places, '0').slice(0, Math.max(places, show))
  return `${whole}.${truncated}`
}

/**
 * Format a raw bigint (18 decimals) to a currency-style display string.
 * Always shows full precision — no small values disappear.
 */
export function displayUsdc(raw: bigint): string {
  return `${formatNativeUsdc(raw)} USDC`
}

/**
 * Sum an array of parsed amounts (bigint[]).
 * Throws if the result exceeds uint256 max (overflow guard).
 * Returns 0n for empty arrays.
 */
export function sumAmounts(amounts: bigint[]): bigint {
  const total = amounts.reduce((acc, a) => acc + a, 0n)
  if (total > UINT256_MAX) {
    throw new RangeError('Total amount overflows uint256')
  }
  return total
}

/**
 * Validate a human-readable amount string.
 * Returns null on success, or an error string on failure.
 */
export function validateAmountStr(s: string): string | null {
  if (!s.trim()) return 'Amount is required'
  const trimmed = s.trim()
  // Reject scientific notation explicitly before parseNativeUsdc
  if (/[eE]/.test(trimmed)) return 'Scientific notation is not accepted — enter a plain decimal number'
  if (trimmed.startsWith('-')) return 'Amount must be positive'
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return 'Enter a valid decimal number'
  const parsed = parseNativeUsdc(trimmed)
  if (parsed === null) return 'Amount has too many decimal places (max 18) or exceeds maximum value'
  if (parsed === 0n) return 'Amount must be greater than zero'
  return null
}

/** Warning threshold: amounts above this are flagged as unusually large. */
const LARGE_AMOUNT_THRESHOLD = parseNativeUsdc('10000')! // 10,000 USDC

/**
 * Returns a warning string if the parsed amount is unusually large, else null.
 */
export function warnLargeAmount(parsed: bigint): string | null {
  if (parsed > LARGE_AMOUNT_THRESHOLD) {
    return `This amount is above 10,000 USDC — double-check before submitting.`
  }
  return null
}

/**
 * Validate an Ethereum address string.
 * Returns null on success, or an error string.
 */
export function validateAddress(s: string): string | null {
  if (!s.trim()) return 'Address is required'
  if (!/^0x[0-9a-fA-F]{40}$/.test(s.trim())) return 'Enter a valid 0x Ethereum address'
  return null
}

/** Shorten an address for display. */
export function shortAddress(addr: string): string {
  if (addr.length < 10) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
