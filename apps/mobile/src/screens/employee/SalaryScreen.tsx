import React from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, spacing, radius, fontSize } from '@/lib/theme'
import { useSession } from '@/hooks/useSession'
import { useQuery } from '@tanstack/react-query'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isWeekend } from 'date-fns'

function CalendarDay({ date, status }: { date: Date; status?: 'ON_TIME' | 'LATE' | 'MISSED' | 'FUTURE' }) {
  const bg = status === 'ON_TIME' ? '#1a3a1a' : status === 'LATE' ? '#3a2a0a' : status === 'MISSED' ? '#3a0a0a' : 'rgba(255,255,255,.04)'
  const tc = status === 'ON_TIME' ? colors.textSuccess : status === 'LATE' ? colors.textWarning : status === 'MISSED' ? colors.textDanger : colors.textMuted
  return (
    <View style={[calS.day, { backgroundColor: bg }]}>
      <Text style={[calS.dayNum, { color: tc }]}>{date.getDate()}</Text>
    </View>
  )
}
const calS = StyleSheet.create({
  day: { flex: 1, height: 32, borderRadius: 5, alignItems: 'center', justifyContent: 'center', margin: 2 },
  dayNum: { fontSize: 9 },
})

export default function SalaryScreen() {
  const { employee } = useSession()
  const { data } = useQuery({
    queryKey: ['salary', employee?.id],
    queryFn: () => fetch(`/api/employees/${employee?.id}/salary`).then(r => r.json()),
    enabled: !!employee?.id,
  })

  const now = new Date()
  const monthDays = eachDayOfInterval({ start: startOfMonth(now), end: endOfMonth(now) })

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.title}>Salary</Text>

        {/* YTD summary */}
        <View style={s.card}>
          <View style={s.row}>
            <View>
              <Text style={s.label}>Earned this month</Text>
              <Text style={s.bigVal}>${data?.earnedThisMonth?.toFixed(2) ?? '—'}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.label}>Monthly salary</Text>
              <Text style={s.subVal}>${data?.monthlySalary?.toFixed(2) ?? '—'}</Text>
            </View>
          </View>
          <View style={s.barBg}>
            <View style={[s.barFill, { width: `${Math.min((data?.earnedThisMonth ?? 0) / (data?.monthlySalary ?? 1) * 100, 100)}%` }]} />
          </View>
        </View>

        {/* Calendar */}
        <Text style={s.sectionLabel}>{format(now, 'MMMM yyyy')} Attendance</Text>
        <View style={s.calGrid}>
          {monthDays.map(d => {
            const ci = data?.checkIns?.find((c: { date: string }) => new Date(c.date).toDateString() === d.toDateString())
            const status = isWeekend(d) ? 'FUTURE' : ci?.status ?? (d > now ? 'FUTURE' : 'MISSED')
            return <CalendarDay key={d.toISOString()} date={d} status={status} />
          })}
        </View>

        {/* Transactions */}
        <Text style={s.sectionLabel}>Recent Releases</Text>
        {(data?.releases ?? []).slice(0, 10).map((r: { id: string; date: string; txHash?: string; amount: string }) => (
          <View key={r.id} style={s.txRow}>
            <View>
              <Text style={s.txTitle}>Daily release</Text>
              <Text style={s.txSub}>{format(new Date(r.date), 'EEE MMM d')}{r.txHash ? ` · ${r.txHash.slice(0, 10)}…` : ''}</Text>
            </View>
            <Text style={s.txAmt}>+${(Number(r.amount) / 1e6).toFixed(2)}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: colors.bgPage },
  scroll:       { padding: spacing.lg, paddingBottom: 80 },
  title:        { fontSize: fontSize.lg, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.lg },
  card:         { backgroundColor: colors.bgCard, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg },
  row:          { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  label:        { fontSize: fontSize.xs, color: colors.textSecondary, marginBottom: 2 },
  bigVal:       { fontSize: fontSize.xl, fontWeight: '600', color: colors.textPrimary, letterSpacing: -.5 },
  subVal:       { fontSize: fontSize.base, color: colors.textSecondary },
  barBg:        { height: 3, backgroundColor: 'rgba(255,255,255,.08)', borderRadius: 2 },
  barFill:      { height: 3, backgroundColor: colors.accentB, borderRadius: 2 },
  sectionLabel: { fontSize: fontSize.xs, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: .7, marginBottom: spacing.sm, marginTop: spacing.lg },
  calGrid:      { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
  txRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderColor: 'rgba(45,45,78,.5)' },
  txTitle:      { fontSize: fontSize.base, color: colors.textPrimary, marginBottom: 2 },
  txSub:        { fontSize: fontSize.xs, color: colors.textSecondary },
  txAmt:        { fontSize: fontSize.md, fontWeight: '500', color: colors.textSuccess },
})
