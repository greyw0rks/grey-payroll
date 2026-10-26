import React from 'react'
import { it, vi, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import { CompanyShell } from '@/components/ui/CompanyShell'
import EmployerDashboard from '@/app/(employer)/dashboard/page'
import EmployeeDashboard from '@/app/(employee)/home/page'
import { formatMoney } from '@/lib/money'

const fixture = vi.hoisted(() => ({ role: 'employer' }))
vi.mock('next/navigation', () => ({ usePathname: () => fixture.role === 'employer' ? '/dashboard' : '/home', useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.PropsWithChildren<{ href: string }>) => <a href={href} {...props}>{children}</a> }))
vi.mock('@clerk/nextjs', () => ({ UserButton: () => <button aria-label="Example account" className="employee-avatar">AE</button> }))
vi.mock('@/components/employer/TreasuryWidget', () => ({ TreasuryWidget: () => <section className="wallet-summary"><h2>Remaining treasury balance</h2><p className="wallet-amount">8,450.00 USDC</p><p>Synthetic treasury balance for visual inspection.</p><button className="grey-button mt-6">Manage treasury</button></section> }))
vi.mock('@/components/employee/WalletBalance', () => ({ WalletBalance: () => <section className="wallet-summary"><h2>My wallet balance</h2><p className="wallet-amount">662.80 USDC</p><p>Synthetic wallet balance for visual inspection.</p><span className="wallet-address">0x71C9…4eAa</span></section> }))
vi.mock('@/lib/company-data', () => {
  const people = [
    { id: 'ada', firstName: 'Ada', lastName: 'Example', jobTitle: 'Backend engineer', status: 'ACTIVE' },
    { id: 'tunde', firstName: 'Tunde', lastName: 'Example', jobTitle: 'Product designer', status: 'ACTIVE' },
    { id: 'bisi', firstName: 'Bisi', lastName: 'Example', jobTitle: 'HR manager', status: 'ACTIVE' },
    { id: 'femi', firstName: 'Femi', lastName: 'Example', jobTitle: 'Sales lead', status: 'ACTIVE' },
    { id: 'new', firstName: 'Ngozi', lastName: 'Example', jobTitle: 'Frontend engineer', status: 'PENDING', inviteCode: 'GRY-X7K2-ABCD', inviteExpiry: new Date('2099-12-01') },
  ]
  const employer = { id: 'labtech-example', companyName: 'Labtech', timezone: 'Africa/Lagos', treasuryContractAddress: null, checkInWindowStart: '07:00', checkInWindowEnd: '10:00', workingDaysPerMonth: 22 }
  return {
    getEmployer: async () => employer,
    getEmployee: async () => ({ id: 'ada', firstName: 'Ada', lastName: 'Example', jobTitle: 'Backend engineer', dailyRate: '54545454', currency: 'USDC', walletAddress: null, employer }),
    getCompanyOverview: async () => ({ employees: people, checkedIn: [{ employeeId: 'ada' }, { employeeId: 'tunde' }], activeCount: 4, invitedCount: 1, onLeaveCount: 1, onLeaveIds: ['femi'], atWorkCount: 2, awaitingCheckInCount: 1, settledUsdc: '5200000000', releaseCount: 24, requests: [{ id: 'leave', name: 'Tunde Example', kind: 'Leave', detail: '3 days · annual', amount: null, currency: '' }, { id: 'refund', name: 'Bisi Example', kind: 'Refund', detail: 'Transport to a supplier meeting', amount: '85000000', currency: 'USDC' }] }),
  }
})
vi.mock('@grey/db', () => ({ prisma: { checkIn: { findMany: async () => [{ id: 'day1', date: new Date('2026-10-23'), status: 'ON_TIME', amount: '54545454' }, { id: 'day2', date: new Date('2026-10-22'), status: 'LATE', amount: '54545454' }] }, salaryRelease: { findMany: async () => [{ amount: '54545454' }] }, leaveRequest: { findMany: async () => [] }, refundRequest: { findMany: async () => [{ id: 'refund', category: 'Transport', description: 'Travel to a supplier meeting', status: 'PENDING', amount: '85000000', currency: 'USDC' }] } } }))

it('renders production dashboard components with explicitly synthetic fixtures for browser inspection', async () => {
  const css = await readFile(path.resolve('app/globals.css'), 'utf8')
  const config = (await import('../tailwind.config')).default
  const compiled = await postcss([tailwind(config)]).process(css, { from: undefined })
  const directory = path.resolve('.impeccable/review/render')
  await mkdir(directory, { recursive: true })
  const fontCss = `@font-face{font-family:DM;src:url(/fonts/dm-sans-latin-400-normal.woff2)}@font-face{font-family:DM;src:url(/fonts/dm-sans-latin-500-normal.woff2);font-weight:500}@font-face{font-family:DM;src:url(/fonts/dm-sans-latin-600-normal.woff2);font-weight:600}body{--font-inter:DM;--font-sora:DM;--font-jbmono:monospace}.fixture-label{padding:8px 20px;background:#E8F7EB;color:#245C36;font:12px DM}`
  for (const role of ['employer', 'employee'] as const) {
    fixture.role = role
    const page = role === 'employer' ? await EmployerDashboard() : await EmployeeDashboard()
    const markup = renderToStaticMarkup(<CompanyShell companyName="Labtech" role={role}>{page}</CompanyShell>)
    expect(markup).toContain('Labtech')
    expect(markup).not.toContain('Company B')
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${fontCss}\n${compiled.css}</style></head><body><div class="fixture-label">Visual inspection · synthetic Labtech example · account and wallet chrome stubbed</div>${markup}</body></html>`
    await writeFile(path.join(directory, `${role}.html`), html)
  }
  expect(formatMoney('1200000000')).toBe('1,200.00 USDC')
})
