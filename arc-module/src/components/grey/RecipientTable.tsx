/**
 * RecipientTable — add/remove recipients and enter exact USDC amounts.
 * Validates addresses and amounts; flags duplicates and unusually large values.
 * Changes invalidate the confirmation checkbox (parent handles this).
 */
import React from 'react'
import { Plus, Trash2, AlertTriangle, AlertCircle } from 'lucide-react'
import type { RecipientRow, RowValidation } from '@/grey/types'
import { validateAddress, validateAmountStr, warnLargeAmount, parseNativeUsdc } from '@/grey/money'
import { Button } from './Button'
import { useRef, useState } from 'react'
import { parseCompanyPayrollCsv } from '@/grey/company-csv'

interface RecipientTableProps {
  rows: RecipientRow[]
  onChange: (rows: RecipientRow[]) => void
  /** When true, all edits are disabled (execution in progress). */
  locked?: boolean
}

function validateRow(row: RecipientRow, allRows: RecipientRow[]): RowValidation {
  const addressError = validateAddress(row.address)
  const amountError = validateAmountStr(row.amountStr)
  // Duplicate check
  const isDuplicate =
    !addressError &&
    allRows.some((r) => r.id !== row.id && r.address.toLowerCase() === row.address.toLowerCase())
  const finalAddressError = isDuplicate ? 'Duplicate recipient address.' : addressError

  const parsed = parseNativeUsdc(row.amountStr)
  const amountWarning = !amountError && parsed ? warnLargeAmount(parsed) : null

  return { addressError: finalAddressError, amountError, amountWarning }
}

export function RecipientTable({ rows, onChange, locked = false }: RecipientTableProps) {
  const csvInput = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState('')
  function addRow() {
    const newRow: RecipientRow = {
      id: crypto.randomUUID(),
      address: '',
      amountStr: '',
    }
    onChange([...rows, newRow])
  }

  function removeRow(id: string) {
    onChange(rows.filter((r) => r.id !== id))
  }

  function updateRow(id: string, patch: Partial<RecipientRow>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  return (
    <div className="space-y-3">
      <input ref={csvInput} type="file" accept=".csv,text/csv" className="hidden" aria-label="Company payroll CSV" onChange={event => { void (async () => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file || locked) return
        setImportError('')
        try {
          if (file.size > 100_000) throw new Error('Use a CSV smaller than 100 KB.')
          const imported = parseCompanyPayrollCsv(await file.text())
          const next = [...rows.filter(row => row.address || row.amountStr), ...imported]
          if (next.length > 50) throw new Error('This import would exceed 50 recipients. Start a new run.')
          onChange(next)
        }
        catch (error) { setImportError(error instanceof Error ? error.message : 'Could not import the CSV.') }
      })() }} />
      <Button type="button" variant="secondary" size="md" disabled={locked} onClick={() => csvInput.current?.click()}>Import company CSV</Button>
      <p className="text-xs text-[#60645F]">Imports add recipients to this draft. Review every wallet and amount before approval.</p>
      {importError ? <p role="alert" className="text-xs text-[#D63B3B]">{importError}</p> : null}
      {rows.length === 0 && (
        <div className="text-center py-8 text-sm text-[#6B6B6B]">
          No recipients yet. Add a recipient below.
        </div>
      )}

      {rows.map((row, idx) => {
        const v = validateRow(row, rows)
        const hasError = !!(v.addressError || v.amountError)
        return (
          <div
            key={row.id}
            className={`bg-white border rounded-xl p-4 space-y-3 ${hasError ? 'border-[#D63B3B]' : 'border-[#E8E6DF]'}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#6B6B6B]">Recipient {idx + 1}</span>
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                disabled={locked}
                className="text-[#6B6B6B] hover:text-[#D63B3B] transition-colors p-1 rounded disabled:opacity-30 disabled:pointer-events-none"
                aria-label={`Remove recipient ${idx + 1}`}
              >
                <Trash2 size={14} />
              </button>
            </div>

            {/* Address input */}
            <div>
              <label className="block text-xs font-medium text-[#16181C] mb-1">
                Wallet address
              </label>
              <input
                type="text"
                value={row.address}
                onChange={(e) => updateRow(row.id, { address: e.target.value })}
                placeholder="0x..."
                spellCheck={false}
                disabled={locked}
                aria-label={`Recipient ${idx + 1} wallet address`}
                aria-invalid={!!v.addressError}
                className={`w-full h-10 px-3 text-sm font-mono border rounded-lg bg-[#F9F8F5] text-[#16181C] placeholder:text-[#BABABA] focus:outline-none focus:ring-2 focus:ring-[#16181C] disabled:opacity-50 ${v.addressError ? 'border-[#D63B3B]' : 'border-[#E8E6DF]'}`}
              />
              {v.addressError && (
                <p className="mt-1 text-xs text-[#D63B3B] flex items-center gap-1">
                  <AlertCircle size={11} />
                  {v.addressError}
                </p>
              )}
            </div>

            {/* Amount input */}
            <div>
              <label className="block text-xs font-medium text-[#16181C] mb-1">
                Amount (USDC, native Arc — 18 decimals max)
              </label>
              <div className="relative">
                <input
                  type="text"
                  inputMode="decimal"
                  value={row.amountStr}
                  onChange={(e) => updateRow(row.id, { amountStr: e.target.value })}
                  placeholder="0.00"
                  disabled={locked}
                  aria-label={`Recipient ${idx + 1} amount`}
                  aria-invalid={!!v.amountError}
                  className={`w-full h-10 pl-3 pr-16 text-sm tabular-nums border rounded-lg bg-[#F9F8F5] text-[#16181C] placeholder:text-[#BABABA] focus:outline-none focus:ring-2 focus:ring-[#16181C] disabled:opacity-50 ${v.amountError ? 'border-[#D63B3B]' : 'border-[#E8E6DF]'}`}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#6B6B6B] font-mono">USDC</span>
              </div>
              {v.amountError && (
                <p className="mt-1 text-xs text-[#D63B3B] flex items-center gap-1">
                  <AlertCircle size={11} />
                  {v.amountError}
                </p>
              )}
              {v.amountWarning && !v.amountError && (
                <p className="mt-1 text-xs text-amber-700 flex items-center gap-1">
                  <AlertTriangle size={11} />
                  {v.amountWarning}
                  {' '}
                  <em className="not-italic font-medium text-amber-600">(review check)</em>
                </p>
              )}
            </div>
          </div>
        )
      })}

      <Button
        type="button"
        variant="secondary"
        size="md"
        onClick={addRow}
        disabled={rows.length >= 50 || locked}
        className="w-full"
      >
        <Plus size={15} />
        Add Recipient {rows.length > 0 && `(${rows.length}/50)`}
      </Button>
    </div>
  )
}
