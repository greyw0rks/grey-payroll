/**
 * Grey Payroll — deterministic run ID utilities.
 *
 * A runId is a bytes32 value that must be:
 * - Non-zero.
 * - Unique per employer and payroll run.
 * - Cryptographically random (32 bytes from CSPRNG).
 * - Stable across retries and page reloads (generated once, persisted).
 * - Never silently replaced after a pending send.
 *
 * Implementation note: previous versions passed 16 random bytes + 8 timestamp
 * bytes (24 bytes total) as the `bytes32` slot of `encodePacked`, which pads
 * with 12 zero bytes and reduces entropy. This version generates a full 32-byte
 * random nonce directly via crypto.getRandomValues and XORs the employer
 * address and timestamp in as additional domain separation — all in bigint
 * arithmetic so the final keccak256 input is well-formed.
 */
import { keccak256 } from 'viem'

/**
 * Generate a strong unique run ID.
 * - 32 cryptographically random bytes from CSPRNG.
 * - Domain-separated by employer address and current timestamp.
 * - Result: keccak256(nonce32 ‖ employer_bytes ‖ timestamp_bytes) → bytes32.
 *
 * Call this ONCE per run and persist the result in localStorage BEFORE
 * submitting the transaction. Never regenerate after submission.
 */
export function generateRunId(employer: string): `0x${string}` {
  // 32 random bytes — full CSPRNG entropy, no truncation
  const nonce = crypto.getRandomValues(new Uint8Array(32))

  // Employer address: strip 0x, left-pad to 20 bytes (standard address encoding)
  const addrHex = employer.toLowerCase().replace(/^0x/, '').padStart(40, '0')
  const addrBytes = hexToBytes(addrHex) // 20 bytes

  // Timestamp: 8-byte big-endian uint64
  const ts = BigInt(Date.now())
  const tsBytes = bigintToBytes(ts, 8) // 8 bytes

  // Concatenate: nonce(32) || employer(20) || timestamp(8) = 60 bytes
  const payload = new Uint8Array(60)
  payload.set(nonce, 0)
  payload.set(addrBytes, 32)
  payload.set(tsBytes, 52)

  // keccak256 accepts Uint8Array directly — avoids the `0x${string}` cast issue.
  return keccak256(payload)
}

/**
 * Returns true if the runId is a valid non-zero 32-byte hex string.
 */
export function isValidRunId(runId: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(runId) && runId !== `0x${'0'.repeat(64)}`
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : '0' + hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function bigintToBytes(n: bigint, size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  let v = n
  for (let i = size - 1; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn)
    v >>= 8n
  }
  return bytes
}
