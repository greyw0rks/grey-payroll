import { requireEmployer, isAuthError } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@grey/db'
import { chatText } from '@/lib/ai'

const SYSTEM_PROMPT = `You are an HR risk advisor for Grey, a crypto payroll platform.
An employer is reviewing a pending employee request (a salary advance or an expense refund).
Weigh the employee's attendance, outstanding loan load, salary ratio, and request history.
Give a grounded second opinion — the human employer makes the final call.

Return ONLY a JSON object with these exact fields — no markdown, no explanation:
{
  "verdict": "APPROVE" | "REVIEW" | "REJECT",
  "confidence": number,        // 0-100, how sure you are of the verdict
  "reasoning": string,          // ONE concise sentence a busy employer can read at a glance
  "flags": string[]             // 0-3 short risk flags, e.g. "High loan load", "Possible duplicate receipt"
}

Guidance:
- APPROVE: clean attendance, low/no outstanding balance, reasonable amount vs salary, no anomalies.
- REVIEW: borderline signals (large amount vs salary, some missed days, thin history) — worth a human look.
- REJECT: strong risk (poor attendance + large request, heavy existing loan load, likely duplicate expense).
- Keep reasoning under 20 words. Never invent data you were not given.`

const USDC = 1e6

function usd(wei: string | null | undefined) {
  if (!wei) return 0
  return Number(wei) / USDC
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  const auth = await requireEmployer()
  if (isAuthError(auth)) return auth.error
  const { userId } = auth

  const { kind, id } = await params
  if (kind !== 'advance' && kind !== 'refund') {
    return NextResponse.json({ error: 'Unsupported request kind' }, { status: 400 })
  }

  // Fetch the target request + owning employee, verify employer ownership.
  const request =
    kind === 'advance'
      ? await prisma.advanceRequest.findUnique({
          where: { id },
          include: { employee: { include: { employer: true } } },
        })
      : await prisma.refundRequest.findUnique({
          where: { id },
          include: { employee: { include: { employer: true } } },
        })

  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (request.employee.employer.clerkUserId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const employee = request.employee
  const since = new Date()
  since.setDate(since.getDate() - 30)
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  // Gather reasoning context in parallel.
  const [checkIns, approvedAdvances, priorRefunds] = await Promise.all([
    prisma.checkIn.findMany({
      where: { employeeId: employee.id, date: { gte: since } },
      select: { status: true },
    }),
    prisma.advanceRequest.findMany({
      where: { employeeId: employee.id, status: 'APPROVED' },
      select: { amount: true, outstandingBalance: true },
    }),
    prisma.refundRequest.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, amount: true, category: true, description: true, status: true, createdAt: true },
    }),
  ])

  const attendance = {
    onTime: checkIns.filter((c) => c.status === 'ON_TIME').length,
    late: checkIns.filter((c) => c.status === 'LATE').length,
    missed: checkIns.filter((c) => c.status === 'MISSED').length,
    total: checkIns.length,
  }

  const outstandingLoanTotal = approvedAdvances.reduce((sum, a) => sum + usd(a.outstandingBalance), 0)
  const monthlySalary = usd(employee.monthlySalary)

  // Build kind-specific context block.
  let requestContext: string
  if (kind === 'advance') {
    const adv = request as Extract<typeof request, { reason: string }>
    const amount = usd(adv.amount)
    const pctOfSalary = monthlySalary > 0 ? Math.round((amount / monthlySalary) * 100) : null
    requestContext = [
      `Request type: Salary advance`,
      `Amount requested: $${amount.toFixed(2)} USDC${pctOfSalary !== null ? ` (${pctOfSalary}% of monthly salary)` : ''}`,
      `Stated reason: ${adv.reason || '(none given)'}`,
      `Prior approved advances: ${approvedAdvances.length}`,
      `Total outstanding loan/advance balance: $${outstandingLoanTotal.toFixed(2)} USDC`,
    ].join('\n')
  } else {
    const ref = request as Extract<typeof request, { category: string }>
    const amount = usd(ref.amount)
    // Duplicate heuristic: another refund w/ same category + same wei amount.
    const duplicates = priorRefunds.filter(
      (r) => r.id !== ref.id && r.category === ref.category && r.amount === ref.amount,
    )
    const monthToDate = priorRefunds
      .filter((r) => r.createdAt >= monthStart && r.status !== 'REJECTED')
      .reduce((sum, r) => sum + usd(r.amount), 0)
    requestContext = [
      `Request type: Expense refund`,
      `Amount claimed: $${amount.toFixed(2)} USDC`,
      `Category: ${ref.category}`,
      `Description: ${ref.description || '(none given)'}`,
      `Has receipt attached: ${ref.ipfsDocHash ? 'yes' : 'no'}`,
      `Possible duplicate claims (same category + amount): ${duplicates.length}`,
      `This employee's month-to-date refund total: $${monthToDate.toFixed(2)} USDC`,
    ].join('\n')
  }

  const daysEmployed = Math.max(
    0,
    Math.floor((Date.now() - new Date(employee.startDate).getTime()) / 86_400_000),
  )

  const userPrompt = [
    `Employee: ${employee.firstName} ${employee.lastName} — ${employee.jobTitle}`,
    `Employment status: ${employee.status}`,
    `Monthly salary: $${monthlySalary.toFixed(2)} USDC`,
    `Days employed: ${daysEmployed}`,
    ``,
    `Attendance (last 30 days): ${attendance.onTime} on-time, ${attendance.late} late, ${attendance.missed} missed (${attendance.total} recorded days)`,
    ``,
    requestContext,
    ``,
    `Give your verdict as JSON.`,
  ].join('\n')

  try {
    const text = await chatText({ system: SYSTEM_PROMPT, user: userPrompt, maxTokens: 512 })
    const parsed = JSON.parse(text)
    // Models return confidence as either 0-1 or 0-100 — normalize to 0-100.
    let confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0
    if (confidence > 0 && confidence <= 1) confidence = Math.round(confidence * 100)
    else confidence = Math.round(confidence)
    return NextResponse.json({
      verdict: parsed.verdict ?? 'REVIEW',
      confidence,
      reasoning: parsed.reasoning ?? '',
      flags: Array.isArray(parsed.flags) ? parsed.flags.slice(0, 3) : [],
    })
  } catch {
    return NextResponse.json(
      { verdict: 'REVIEW', confidence: 0, reasoning: 'AI review unavailable — please assess manually.', flags: [] },
      { status: 422 },
    )
  }
}
