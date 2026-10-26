import { auth, clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@grey/db'
import { DEFAULT_ARC_CHAIN_ID } from '@/lib/arc-chain'

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
  return NextResponse.json({ error: 'Link an Arc treasury with an employer wallet signature from the dashboard.' }, { status: 410 })
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth()
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const { companyName, email, industry, country, timezone } = body
    if (typeof companyName !== 'string' || !companyName.trim() || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Company name and a valid work email are required.' }, { status: 400 })
    }
    try { new Intl.DateTimeFormat('en', { timeZone: timezone || 'Africa/Lagos' }) }
    catch { return NextResponse.json({ error: 'Choose a valid timezone.' }, { status: 400 }) }
    const employeeAccount = await prisma.employee.findUnique({ where: { clerkUserId: userId } })
    if (employeeAccount) return NextResponse.json({ error: 'This account already belongs to an employer.' }, { status: 409 })

    // Check first to avoid a Prisma unique-constraint error on re-registration.
    const existing = await prisma.employer.findUnique({ where: { clerkUserId: userId } })
    const employer = existing ?? await prisma.employer.create({
      data: { clerkUserId: userId, companyName: companyName.trim(), email: email.trim().toLowerCase(), industry, country, timezone, arcChainId: DEFAULT_ARC_CHAIN_ID },
    })

    const client = await clerkClient()
    await client.users.updateUserMetadata(userId, {
      publicMetadata: { role: 'employer', employerId: employer.id },
    })

    return NextResponse.json({ id: employer.id })
  } catch (err) {
    return NextResponse.json({ error: 'Could not register your company. Check your details and try again.' }, { status: 400 })
  }
}
