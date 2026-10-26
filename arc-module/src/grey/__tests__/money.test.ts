/**
 * Tests for src/grey/money.ts
 *
 * Covers: parseNativeUsdc, formatNativeUsdc, sumAmounts, validateAmountStr,
 * validateAddress, uint256 boundary, one-wei precision, 18-decimal edge cases.
 */
import { describe, it, expect } from 'vitest'
import {
  parseNativeUsdc,
  formatNativeUsdc,
  sumAmounts,
  validateAmountStr,
  validateAddress,
  UINT256_MAX,
  NATIVE_USDC_DECIMALS,
} from '../money'

describe('parseNativeUsdc', () => {
  it('parses one wei (0.000000000000000001)', () => {
    expect(parseNativeUsdc('0.000000000000000001')).toBe(1n)
  })

  it('parses 18 zeros after dot then 1', () => {
    // 1 followed by 18 zeros is exactly 10^18 * 10^18 which would overflow, but
    // "0.000000000000000001" is just 1n.  Test a non-trivial sub-unit value.
    expect(parseNativeUsdc('0.000000000000000010')).toBe(10n)
  })

  it('parses 0.01 USDC correctly', () => {
    expect(parseNativeUsdc('0.01')).toBe(10_000_000_000_000_000n)
  })

  it('parses 0.02 USDC correctly', () => {
    expect(parseNativeUsdc('0.02')).toBe(20_000_000_000_000_000n)
  })

  it('parses 1.25', () => {
    expect(parseNativeUsdc('1.25')).toBe(1_250_000_000_000_000_000n)
  })

  it('parses whole number', () => {
    expect(parseNativeUsdc('1')).toBe(1_000_000_000_000_000_000n)
  })

  it('parses 0', () => {
    expect(parseNativeUsdc('0')).toBe(0n)
  })

  it('parses max safe amount (large valid bigint)', () => {
    const parsed = parseNativeUsdc('1000000')
    expect(parsed).toBe(1_000_000n * 10n ** 18n)
  })

  it('rejects scientific notation', () => {
    expect(parseNativeUsdc('1e18')).toBeNull()
    expect(parseNativeUsdc('1E18')).toBeNull()
  })

  it('rejects negative values', () => {
    expect(parseNativeUsdc('-1')).toBeNull()
  })

  it('rejects empty string', () => {
    expect(parseNativeUsdc('')).toBeNull()
    expect(parseNativeUsdc('   ')).toBeNull()
  })

  it('rejects more than 18 decimal places', () => {
    expect(parseNativeUsdc('0.0000000000000000001')).toBeNull() // 19 decimals
  })

  it('accepts exactly 18 decimal places', () => {
    expect(parseNativeUsdc('0.000000000000000001')).toBe(1n) // exactly 18 dec
  })

  it('rejects uint256 overflow', () => {
    const overHuman = (UINT256_MAX / 10n ** BigInt(NATIVE_USDC_DECIMALS) + 1n).toString()
    expect(parseNativeUsdc(overHuman)).toBeNull()
  })

  it('accepts exactly UINT256_MAX as raw (whole number = UINT256_MAX / 10^18 floor)', () => {
    // Largest parseable whole number = floor(UINT256_MAX / 10^18)
    const maxWhole = UINT256_MAX / 10n ** BigInt(NATIVE_USDC_DECIMALS)
    const parsed = parseNativeUsdc(maxWhole.toString())
    // Should parse successfully
    expect(parsed).not.toBeNull()
    if (parsed !== null) {
      expect(parsed).toBeLessThanOrEqual(UINT256_MAX)
    }
  })

  it('rejects non-numeric strings', () => {
    expect(parseNativeUsdc('abc')).toBeNull()
    expect(parseNativeUsdc('1.2.3')).toBeNull()
    expect(parseNativeUsdc('0x1')).toBeNull()
  })
})

describe('formatNativeUsdc', () => {
  it('formats 0n as "0"', () => {
    expect(formatNativeUsdc(0n)).toBe('0')
  })

  it('formats 1n (one wei) with full 18 decimal places', () => {
    expect(formatNativeUsdc(1n)).toBe('0.000000000000000001')
  })

  it('formats 1_000_000_000_000n (1 μUSDC ERC-20 unit) to "0.000001"', () => {
    // 1e12 wei = 1e12 / 1e18 = 1e-6 USDC
    expect(formatNativeUsdc(1_000_000_000_000n)).toBe('0.000001')
  })

  it('formats 1.25 USDC correctly', () => {
    expect(formatNativeUsdc(1_250_000_000_000_000_000n)).toBe('1.25')
  })

  it('formats a whole-number USDC without decimal part', () => {
    expect(formatNativeUsdc(1_000_000_000_000_000_000n)).toBe('1')
  })

  it('does NOT truncate 0.01 USDC to zero', () => {
    const val = 10_000_000_000_000_000n // 0.01 USDC in 18-dec
    const result = formatNativeUsdc(val)
    expect(result).toBe('0.01')
  })

  it('does NOT truncate 0.02 USDC to zero', () => {
    const val = 20_000_000_000_000_000n // 0.02 USDC
    const result = formatNativeUsdc(val)
    expect(result).toBe('0.02')
  })

  it('shows at least the default places for clean values', () => {
    // formatNativeUsdc(1_000_000_000_000_000_000n) = '1' (no trailing .00 when whole)
    expect(formatNativeUsdc(1_000_000_000_000_000_000n)).toBe('1')
  })

  it('round-trips through parseNativeUsdc', () => {
    const raw = 12_345_678_901_234_567n
    const formatted = formatNativeUsdc(raw)
    const reparsed = parseNativeUsdc(formatted)
    expect(reparsed).toBe(raw)
  })
})

describe('sumAmounts', () => {
  it('sums an empty array to 0n', () => {
    expect(sumAmounts([])).toBe(0n)
  })

  it('sums correctly', () => {
    expect(sumAmounts([1n, 2n, 3n])).toBe(6n)
  })

  it('throws on uint256 overflow', () => {
    const big = UINT256_MAX / 2n + 1n
    expect(() => sumAmounts([big, big])).toThrow(RangeError)
  })

  it('does not overflow when sum equals UINT256_MAX', () => {
    expect(() => sumAmounts([UINT256_MAX])).not.toThrow()
    expect(sumAmounts([UINT256_MAX])).toBe(UINT256_MAX)
  })
})

describe('validateAmountStr', () => {
  it('returns null for a valid amount', () => {
    expect(validateAmountStr('1.25')).toBeNull()
    expect(validateAmountStr('0.01')).toBeNull()
    expect(validateAmountStr('0.000000000000000001')).toBeNull()
  })

  it('rejects empty string', () => {
    expect(validateAmountStr('')).toBeTruthy()
  })

  it('rejects zero', () => {
    expect(validateAmountStr('0')).toBeTruthy()
  })

  it('rejects negative', () => {
    expect(validateAmountStr('-1')).toBeTruthy()
  })

  it('rejects scientific notation', () => {
    expect(validateAmountStr('1e18')).toBeTruthy()
  })

  it('rejects too many decimals', () => {
    expect(validateAmountStr('0.0000000000000000001')).toBeTruthy() // 19 dec
  })
})

describe('validateAddress', () => {
  it('accepts a valid checksummed address', () => {
    expect(validateAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBeNull()
  })

  it('accepts lowercase address', () => {
    expect(validateAddress('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')).toBeNull()
  })

  it('rejects empty string', () => {
    expect(validateAddress('')).toBeTruthy()
  })

  it('rejects address without 0x prefix', () => {
    expect(validateAddress('d8da6bf26964af9d7eed9e03e53415d37aa96045')).toBeTruthy()
  })

  it('rejects too-short address', () => {
    expect(validateAddress('0x1234')).toBeTruthy()
  })

  it('rejects non-hex characters', () => {
    expect(validateAddress('0xZZZZ6bf26964af9d7eed9e03e53415d37aa96045')).toBeTruthy()
  })
})
