import { requireEmployee, isAuthError } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@grey/db'
import { toDatabaseAmount } from '@/lib/money'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEmployee()
  if (isAuthError(auth)) return auth.error
  const { userId } = auth

  const { id } = await params
  const employee = await prisma.employee.findUnique({ where: { id, clerkUserId: userId } })
  if (!employee) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (employee.currency !== 'USDC') return NextResponse.json({ error: 'Set a USDC salary before requesting an Arc refund.' }, { status: 409 })

  const { amount, category, description } = await req.json()
  let amountBase: string
  try { amountBase = toDatabaseAmount(String(amount)) }
  catch { return NextResponse.json({ error: 'Enter a positive refund amount with up to six decimal places.' }, { status: 400 }) }
  if (typeof category !== 'string' || !category.trim()) return NextResponse.json({ error: 'Choose an expense category.' }, { status: 400 })

  const request = await prisma.refundRequest.create({
    data: {
      employeeId: id,
      amount: amountBase,
      currency: employee.currency,
      category,
      description: description ?? '',
      ipfsDocHash: '',
      status: 'PENDING',
    },
  })

  return NextResponse.json({ request })
}
