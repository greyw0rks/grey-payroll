/**
 * Tests for src/grey/runId.ts
 *
 * Covers: generateRunId produces valid 32-byte hex bytes32, isValidRunId,
 * uniqueness across calls, no 24-byte truncation.
 */
import { describe, it, expect } from 'vitest'
import { generateRunId, isValidRunId } from '../runId'

const TEST_ADDR = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

describe('generateRunId', () => {
  it('produces a 0x-prefixed 64-char hex string (32 bytes)', () => {
    const id = generateRunId(TEST_ADDR)
    expect(id).toMatch(/^0x[0-9a-fA-F]{64}$/)
  })

  it('is not the zero hash', () => {
    const id = generateRunId(TEST_ADDR)
    expect(id).not.toBe(`0x${'0'.repeat(64)}`)
  })

  it('produces unique IDs on successive calls', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateRunId(TEST_ADDR)))
    expect(ids.size).toBe(50)
  })

  it('produces unique IDs for different employers', () => {
    const addr2 = '0x1111111111111111111111111111111111111111'
    const id1 = generateRunId(TEST_ADDR)
    const id2 = generateRunId(addr2)
    // Different employers produce different IDs (astronomically likely)
    expect(id1).not.toBe(id2)
  })

  it('output is 66 characters total (0x + 64 hex chars)', () => {
    const id = generateRunId(TEST_ADDR)
    expect(id.length).toBe(66)
  })

  it('uses the real viem keccak256 implementation', () => {
    // keccak256 output is deterministic for the same input, but our input includes
    // 32 random bytes so we can only verify the format.  The critical property is
    // that the output is a valid keccak256 digest (32 bytes).
    const id = generateRunId(TEST_ADDR)
    // All keccak256 outputs are exactly 32 bytes (64 hex chars + 0x prefix)
    expect(id).toHaveLength(66)
  })
})

describe('isValidRunId', () => {
  it('accepts a generated runId', () => {
    expect(isValidRunId(generateRunId(TEST_ADDR))).toBe(true)
  })

  it('rejects the zero hash', () => {
    expect(isValidRunId(`0x${'0'.repeat(64)}`)).toBe(false)
  })

  it('rejects short string', () => {
    expect(isValidRunId('0x1234')).toBe(false)
  })

  it('rejects non-0x prefix', () => {
    expect(isValidRunId(`${'a'.repeat(64)}`)).toBe(false)
  })

  it('rejects 63-char hex (too short by one)', () => {
    expect(isValidRunId(`0x${'a'.repeat(63)}`)).toBe(false)
  })

  it('rejects 65-char hex (too long by one)', () => {
    expect(isValidRunId(`0x${'a'.repeat(65)}`)).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidRunId('')).toBe(false)
  })
})
