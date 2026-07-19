import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@grey/db'
import { requireEmployer, isAuthError } from '@/lib/server-auth'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireEmployer()
  if (isAuthError(auth)) return auth.error
  const { employer } = auth

  const { id } = await params
  const body = await req.json()
  const { status } = body

  if (status !== 'TERMINATED') {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const employee = await prisma.employee.findUnique({ where: { id } })
  if (!employee || employee.employerId !== employer.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const updated = await prisma.employee.update({
    where: { id },
    data: { status: 'TERMINATED' },
  })

  return NextResponse.json({ employee: updated })
}
