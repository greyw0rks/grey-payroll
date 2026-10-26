import { validateAddress, validateAmountStr } from './money'
import type { RecipientRow } from './types'

// Company exports have precisely name,wallet,amount columns. Quoted names may
// contain commas or escaped quotes. Amounts stay decimal strings throughout.
export function parseCompanyPayrollCsv(text: string): RecipientRow[] {
  const records: string[][] = []
  let record: string[] = [], field = '', quoted = false
  const source = text.replace(/^\uFEFF/, '')
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { field += '"'; index++ }
      else quoted = !quoted
    } else if (character === ',' && !quoted) { record.push(field); field = '' }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index++
      record.push(field); if (record.some(value => value.trim())) records.push(record)
      record = []; field = ''
    } else field += character
  }
  if (quoted) throw new Error('The CSV has an unclosed quoted field.')
  record.push(field); if (record.some(value => value.trim())) records.push(record)
  const header = records.shift()?.map(value => value.trim().toLowerCase())
  if (header?.join(',') !== 'name,wallet,amount') throw new Error('Use the company CSV with name, wallet and amount columns.')
  if (!records.length || records.length > 50) throw new Error('A payroll run needs between 1 and 50 recipients. Split a larger company export into separate runs.')
  const seen = new Set<string>()
  return records.map((values, index) => {
    if (values.length !== 3) throw new Error(`Row ${index + 2} must have three columns.`)
    const address = values[1].trim(), amountStr = values[2].trim()
    const error = validateAddress(address) || validateAmountStr(amountStr)
    if (error) throw new Error(`Row ${index + 2}: ${error}`)
    if (seen.has(address.toLowerCase())) throw new Error(`Row ${index + 2}: duplicate wallet address.`)
    seen.add(address.toLowerCase())
    return { id: crypto.randomUUID(), address, amountStr }
  })
}
