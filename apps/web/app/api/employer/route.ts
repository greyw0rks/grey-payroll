import { auth, clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@grey/db'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const employer = await prisma.employer.findUnique({ where: { clerkUserId: userId } })
  if (!employer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(employer)
}

export async function PATCH(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  const { treasuryContractAddress } = body
  if (!treasuryContractAddress || !/^0x[0-9a-fA-F]{40}$/.test(treasuryContractAddress)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 })
  }
  const employer = await prisma.employer.update({
    where: { clerkUserId: userId },
    data: { treasuryContractAddress },
  })
  return NextResponse.json({ id: employer.id })
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { companyName, email, industry, country, timezone } = body

    // Check first to avoid a Prisma unique-constraint error on re-registration.
    const existing = await prisma.employer.findUnique({ where: { clerkUserId: userId } })
    const employer = existing ?? await prisma.employer.create({
      data: { clerkUserId: userId, companyName, email, industry, country, timezone },
    })

    const client = await clerkClient()
    await client.users.updateUserMetadata(userId, {
      publicMetadata: { role: 'employer', employerId: employer.id },
    })

    return NextResponse.json({ id: employer.id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Registration failed'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
