import { requireEmployee, isAuthError } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@grey/db'
import { MAX_ADVANCE_PERCENT } from '@grey/config/constants'
import { toDatabaseAmount } from '@/lib/money'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEmployee()
  if (isAuthError(auth)) return auth.error
  const { userId } = auth

  const { id } = await params
  const employee = await prisma.employee.findUnique({ where: { id, clerkUserId: userId } })
  if (!employee) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (employee.currency !== 'USDC') return NextResponse.json({ error: 'Set a USDC salary before requesting an Arc advance.' }, { status: 409 })

  const { amount, reason } = await req.json()
  let amountWei: bigint
  try { amountWei = BigInt(toDatabaseAmount(String(amount))) }
  catch { return NextResponse.json({ error: 'Enter a positive advance amount with up to six decimal places.' }, { status: 400 }) }
  if (typeof reason !== 'string' || !reason.trim()) return NextResponse.json({ error: 'Enter a reason for your advance.' }, { status: 400 })
  const maxWei = (BigInt(employee.monthlySalary) * BigInt(Math.round(MAX_ADVANCE_PERCENT * 100))) / BigInt(100)

  if (amountWei > maxWei) {
    return NextResponse.json(
      { error: `Cannot advance more than ${MAX_ADVANCE_PERCENT * 100}% of monthly salary` },
      { status: 400 }
    )
  }

  const request = await prisma.advanceRequest.create({
    data: { employeeId: id, amount: String(amountWei), reason, outstandingBalance: '0', status: 'PENDING' },
  })

  return NextResponse.json({ request })
}
