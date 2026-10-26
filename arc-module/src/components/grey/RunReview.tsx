/**
 * RunReview — shows the final recipient/amount table, total, and confirmation
 * checkbox before the employer submits.
 * Per spec: changes must invalidate the confirmation; handled by parent.
 */
import React from 'react'
import { CheckCircle, AlertTriangle } from 'lucide-react'
import type { RecipientRow } from '@/grey/types'
import { parseNativeUsdc, formatNativeUsdc, sumAmounts, shortAddress, validateAddress, validateAmountStr } from '@/grey/money'

interface RunReviewProps {
  rows: RecipientRow[]
  contractBalance: bigint | undefined
  confirmed: boolean
  onConfirmChange: (checked: boolean) => void
  /** Advisory: null = clean, string = text of advisory. This is a review check, not a live AI service. */
  advisory: string | null
  /** When true, the confirmation checkbox is disabled (execution in progress). */
  locked?: boolean
}

export function RunReview({ rows, contractBalance, confirmed, onConfirmChange, advisory, locked = false }: RunReviewProps) {
  const parsedAmounts = rows.map((r) => {
    const err = validateAmountStr(r.amountStr) ?? validateAddress(r.address)
    if (err) return null
    return parseNativeUsdc(r.amountStr)
  })

  const allValid = parsedAmounts.every((a) => a !== null)
  const total = allValid ? sumAmounts(parsedAmounts) : null
  const underfunded = total !== undefined && total !== null && contractBalance !== undefined && contractBalance < total

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#16181C]">Review Payroll Run</h3>
        <span className="text-xs text-[#6B6B6B] tabular-nums">{rows.length} recipient{rows.length !== 1 ? 's' : ''}</span>
      </div>

      {!allValid && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="text-[#D63B3B] shrink-0" />
          <p className="text-xs text-[#D63B3B]">
            Fix all errors in the recipient table before reviewing.
          </p>
        </div>
      )}

      {advisory && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="text-amber-700 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-amber-800 font-medium">
              Review check{' '}
              <span className="font-normal text-amber-700">
                — deterministic rule, not a live AI service
              </span>
            </p>
            <p className="text-xs text-amber-700 mt-0.5">{advisory}</p>
          </div>
        </div>
      )}

      {/* Recipient table */}
      <div className="border border-[#E8E6DF] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#F9F8F5] border-b border-[#E8E6DF]">
              <th className="text-left px-4 py-2 text-xs font-medium text-[#6B6B6B]">#</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-[#6B6B6B]">Recipient</th>
              <th className="text-right px-4 py-2 text-xs font-medium text-[#6B6B6B]">Amount (USDC)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const parsed = parsedAmounts[i]
              return (
                <tr key={row.id} className="border-b border-[#F4F3EE] last:border-0">
                  <td className="px-4 py-2.5 text-xs text-[#6B6B6B] tabular-nums">{i + 1}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-[#16181C] break-all">
                    <span className="hidden sm:inline">{row.address}</span>
                    <span className="sm:hidden">{shortAddress(row.address)}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-sm text-[#16181C]">
                    {parsed !== null ? formatNativeUsdc(parsed) : <span className="text-[#D63B3B]">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {total !== null && (
            <tfoot>
              <tr className="bg-[#F9F8F5] border-t border-[#E8E6DF]">
                <td colSpan={2} className="px-4 py-2.5 text-xs font-semibold text-[#16181C]">Total</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-sm font-semibold text-[#16181C]">
                  {formatNativeUsdc(total)} USDC
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Funding status */}
      {total !== null && contractBalance !== undefined && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${underfunded ? 'bg-red-50 border border-red-200 text-[#D63B3B]' : 'bg-green-50 border border-green-200 text-[#1A7A3C]'}`}>
          {underfunded ? (
            <>
              <AlertTriangle size={13} />
              Funded balance ({formatNativeUsdc(contractBalance)} USDC) is below total ({formatNativeUsdc(total)} USDC). Deposit more before executing.
            </>
          ) : (
            <>
              <CheckCircle size={13} />
              Funded balance covers this run.
            </>
          )}
        </div>
      )}

      {/* Confirmation checkbox */}
      {allValid && !underfunded && (
        <label className={`flex items-start gap-3 select-none ${locked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => { if (!locked) onConfirmChange(e.target.checked) }}
            disabled={locked}
            className="mt-0.5 h-4 w-4 rounded border-[#E8E6DF] accent-[#16181C] cursor-pointer disabled:cursor-not-allowed"
            aria-label="Confirm payroll run"
          />
          <span className="text-sm text-[#16181C]">
            I have reviewed all recipients and amounts above and confirm they are correct.
            This will deduct{' '}
            <strong className="tabular-nums">{total !== null ? formatNativeUsdc(total) : '0'} USDC</strong>
            {' '}from my funded contract balance.
          </span>
        </label>
      )}
    </div>
  )
}
