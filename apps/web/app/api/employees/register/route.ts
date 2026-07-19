import { auth, clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@grey/db'

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { inviteCode, walletAddress, phoneNumber, emergencyContact } = body

    const employee = await prisma.employee.findUnique({ where: { inviteCode } })
    if (!employee) return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
    if (employee.status !== 'PENDING') return NextResponse.json({ error: 'Code already used' }, { status: 400 })
    if (employee.inviteExpiry && employee.inviteExpiry < new Date()) {
      return NextResponse.json({ error: 'Code expired' }, { status: 400 })
    }

    await prisma.employee.update({
      where: { id: employee.id },
      data: {
        clerkUserId: userId,
        walletAddress: walletAddress?.toLowerCase() ?? null,
        status: 'ACTIVE',
        phoneNumber,
        emergencyContact,
      },
    })

    const client = await clerkClient()
    await client.users.updateUserMetadata(userId, {
      publicMetadata: { role: 'employee', employeeId: employee.id },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Registration failed'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
