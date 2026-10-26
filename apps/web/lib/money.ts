import { formatUnits, parseUnits } from 'viem'

// Existing Grey database amounts use the six-decimal stablecoin base unit.
export function formatMoney(amount: string | bigint | null | undefined, currency = 'USDC') {
  const decimal = formatUnits(BigInt(amount || '0'), 6)
  const [whole, fraction = ''] = decimal.split('.')
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${grouped}.${fraction.padEnd(2, '0').slice(0, 2)} ${currency === 'LEGACY_ASSET' ? 'historical asset' : currency}`
}

export function toDatabaseAmount(value: string) {
  if (!/^\d+(\.\d{1,6})?$/.test(value.trim()) || parseUnits(value.trim(), 6) <= 0n) {
    throw new Error('Enter a positive amount with up to six decimal places.')
  }
  return parseUnits(value.trim(), 6).toString()
}
