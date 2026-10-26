import { cache } from 'react'
import { auth } from '@clerk/nextjs/server'
import { prisma } from '@grey/db'
import { getCompanyDate } from './checkin'

export const getEmployer = cache(async () => {
  const { userId } = await auth()
  return userId ? prisma.employer.findUnique({ where: { clerkUserId: userId } }) : null
})

export const getEmployee = cache(async () => {
  const { userId } = await auth()
  return userId ? prisma.employee.findUnique({ where: { clerkUserId: userId }, include: { employer: true } }) : null
})

export async function getCompanyOverview(employerId: string, timezone: string, now = new Date()) {
  const today = getCompanyDate(now, timezone)
  const currentMonth = new Date(today)
  currentMonth.setUTCDate(1)
  const scope = { employee: { employerId } }
  const [employees, checkedIn, leaves, advances, refunds, releases] = await Promise.all([
    prisma.employee.findMany({ where: { employerId }, orderBy: { createdAt: 'desc' }, select: { id: true, firstName: true, lastName: true, jobTitle: true, status: true, inviteCode: true, inviteExpiry: true } }),
    prisma.checkIn.findMany({ where: { ...scope, date: today, status: { in: ['ON_TIME', 'LATE'] }, employee: { employerId, status: 'ACTIVE' } }, select: { employeeId: true, timestamp: true, status: true } }),
    prisma.leaveRequest.findMany({ where: { ...scope, status: { in: ['PENDING', 'APPROVED'] } }, include: { employee: { select: { firstName: true, lastName: true, status: true } } }, orderBy: { createdAt: 'desc' } }),
    prisma.advanceRequest.findMany({ where: { ...scope, status: 'PENDING' }, include: { employee: { select: { firstName: true, lastName: true, currency: true } } }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.refundRequest.findMany({ where: { ...scope, status: 'PENDING' }, include: { employee: { select: { firstName: true, lastName: true } } }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.salaryRelease.findMany({ where: { ...scope, arcPaymentItem: { intent: { status: 'CONFIRMED', verifiedAt: { gte: currentMonth } } } }, include: { employee: { select: { currency: true } } } }),
  ])
  const onLeaveIds = new Set(leaves.filter(leave => leave.status === 'APPROVED' && leave.employee.status === 'ACTIVE' && leave.startDate <= today && leave.endDate >= today).map(leave => leave.employeeId))
  const active = employees.filter(employee => employee.status === 'ACTIVE')
  const checkedInIds = new Set(checkedIn.map(checkIn => checkIn.employeeId))
  const requests = [
    ...leaves.filter(leave => leave.status === 'PENDING').map(leave => ({ id: leave.id, name: `${leave.employee.firstName} ${leave.employee.lastName}`, kind: 'Leave', detail: `${leave.totalDays} days · ${leave.type.toLowerCase().replaceAll('_', ' ')}`, amount: null, currency: '', createdAt: leave.createdAt })),
    ...advances.map(advance => ({ id: advance.id, name: `${advance.employee.firstName} ${advance.employee.lastName}`, kind: 'Advance', detail: advance.reason, amount: advance.amount, currency: advance.employee.currency, createdAt: advance.createdAt })),
    ...refunds.map(refund => ({ id: refund.id, name: `${refund.employee.firstName} ${refund.employee.lastName}`, kind: 'Refund', detail: refund.description || refund.category, amount: refund.amount, currency: refund.currency, createdAt: refund.createdAt })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 6)
  return {
    today, employees, checkedIn, requests, activeCount: active.length,
    invitedCount: employees.filter(employee => employee.status === 'PENDING').length,
    onLeaveCount: onLeaveIds.size, onLeaveIds: [...onLeaveIds],
    atWorkCount: active.filter(employee => checkedInIds.has(employee.id) && !onLeaveIds.has(employee.id)).length,
    awaitingCheckInCount: active.filter(employee => !checkedInIds.has(employee.id) && !onLeaveIds.has(employee.id)).length,
    settledUsdc: releases.filter(release => release.employee.currency === 'USDC').reduce((sum, release) => sum + BigInt(release.amount), 0n).toString(),
    releaseCount: releases.length,
  }
}
