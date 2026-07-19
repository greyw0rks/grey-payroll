import { requireEmployee, isAuthError } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@grey/db'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEmployee()
  if (isAuthError(auth)) return auth.error
  const { userId } = auth

  const { id } = await params
  const employee = await prisma.employee.findUnique({ where: { id, clerkUserId: userId } })
  if (!employee) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { amount, category, description } = await req.json()

  const request = await prisma.refundRequest.create({
    data: {
      employeeId: id,
      amount: String(Math.round(Number(amount) * 1e6)),
      category,
      description: description ?? '',
      ipfsDocHash: '',
      status: 'PENDING',
    },
  })

  return NextResponse.json({ request })
}
