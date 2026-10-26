import { randomInt } from 'node:crypto'
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateInviteCode(): string {
  const prefix = 'GRY'
  const block = () => Array.from({ length: 4 }, () => CHARS[randomInt(CHARS.length)]).join('')
  return `${prefix}-${block()}-${block()}`
}
