import { prisma } from '@grey/db'
import { formatUnits } from 'viem'
import { requireEmployer, isAuthError } from '@/lib/server-auth'
export async function GET() {
  const identity = await requireEmployer()
  if (isAuthError(identity)) return identity.error
  const employees = await prisma.employee.findMany({ where: { employerId: identity.employer.id, status: 'ACTIVE', currency: 'USDC', walletAddress: { not: null } }, orderBy: { firstName: 'asc' }, select: { firstName: true, lastName: true, walletAddress: true, monthlySalary: true } })
  const quoted = (value: string) => `"${value.replaceAll('"', '""')}"`
  const csv = ['name,wallet,amount', ...employees.map(employee => [quoted(`${employee.firstName} ${employee.lastName}`), employee.walletAddress, formatUnits(BigInt(employee.monthlySalary), 6)].join(','))].join('\r\n')
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="company-payroll.csv"', 'Cache-Control': 'private, no-store' } })
}
