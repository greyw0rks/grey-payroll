import { auth, clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@grey/db'

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { walletAddress, phoneNumber, emergencyContact } = body
    const inviteCode = typeof body.inviteCode === 'string' ? body.inviteCode.trim().toUpperCase() : ''
    if (!inviteCode) return NextResponse.json({ error: 'Invitation code required' }, { status: 400 })
    if (walletAddress && !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 })
    const [existingEmployee, existingEmployer] = await Promise.all([
      prisma.employee.findUnique({ where: { clerkUserId: userId } }),
      prisma.employer.findUnique({ where: { clerkUserId: userId } }),
    ])
    if (existingEmployee || existingEmployer) return NextResponse.json({ error: 'This account already belongs to a company. Sign in to your existing workspace.' }, { status: 409 })

    const employee = await prisma.employee.findUnique({ where: { inviteCode } })
    if (!employee) return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
    if (employee.status !== 'PENDING') return NextResponse.json({ error: 'Code already used' }, { status: 400 })
    if (employee.inviteExpiry && employee.inviteExpiry < new Date()) {
      return NextResponse.json({ error: 'Code expired' }, { status: 400 })
    }

    const claimed = await prisma.employee.updateMany({
      where: { id: employee.id, status: 'PENDING', clerkUserId: null, inviteCode, OR: [{ inviteExpiry: null }, { inviteExpiry: { gt: new Date() } }] },
      data: {
        clerkUserId: userId,
        walletAddress: walletAddress?.toLowerCase() ?? null,
        status: 'ACTIVE',
        phoneNumber,
        emergencyContact,
        inviteCode: null,
        inviteExpiry: null,
      },
    })
    if (claimed.count !== 1) return NextResponse.json({ error: 'This invitation is no longer available.' }, { status: 409 })

    const client = await clerkClient()
    await client.users.updateUserMetadata(userId, {
      publicMetadata: { role: 'employee', employeeId: employee.id },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: 'Could not activate your account. Sign in again or contact your employer.' }, { status: 400 })
  }
}
