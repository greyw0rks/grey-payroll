export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function truncateAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`
}

export function formatCurrency(weiAmount: bigint, decimals: number, symbol: string): string {
  const human = Number(weiAmount) / 10 ** decimals
  return `$${human.toFixed(2)} ${symbol}`
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
