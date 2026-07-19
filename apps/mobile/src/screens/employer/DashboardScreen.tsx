import React from 'react'
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, spacing, radius, fontSize } from '@/lib/theme'
import { useSession } from '@/hooks/useSession'
import { useQuery } from '@tanstack/react-query'

function KPI({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={kS.kpi}>
      <Text style={kS.label}>{label}</Text>
      <Text style={kS.value}>{value}</Text>
      {sub && <Text style={kS.sub}>{sub}</Text>}
    </View>
  )
}
const kS = StyleSheet.create({
  kpi:   { flex: 1, backgroundColor: colors.bgCard2, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, margin: 4 },
  label: { fontSize: 8, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: .5, marginBottom: 4 },
  value: { fontSize: fontSize.xl, fontWeight: '500', color: colors.textPrimary, letterSpacing: -.5 },
  sub:   { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
})

function RequestRow({ icon, title, sub, badge }: { icon: string; title: string; sub: string; badge: 'review' | 'ready' | 'warning' }) {
  const bc = badge === 'ready' ? { bg: 'rgba(74,222,128,.12)', tc: colors.textSuccess } : badge === 'warning' ? { bg: 'rgba(248,113,113,.12)', tc: colors.textDanger } : { bg: 'rgba(251,191,36,.12)', tc: colors.textWarning }
  return (
    <TouchableOpacity style={rS.row} activeOpacity={0.7}>
      <View style={rS.iconBox}><Text style={rS.icon}>{icon}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={rS.title}>{title}</Text>
        <Text style={rS.sub}>{sub}</Text>
      </View>
      <View style={[rS.badge, { backgroundColor: bc.bg }]}>
        <Text style={[rS.badgeText, { color: bc.tc }]}>{badge.charAt(0).toUpperCase() + badge.slice(1)}</Text>
      </View>
    </TouchableOpacity>
  )
}
const rS = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10, borderBottomWidth: 1, borderColor: 'rgba(45,45,78,.5)' },
  iconBox:   { width: 32, height: 32, borderRadius: radius.md, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  icon:      { fontSize: 16 },
  title:     { fontSize: fontSize.base, color: '#dde4f0', fontWeight: '500', marginBottom: 1 },
  sub:       { fontSize: fontSize.xs, color: colors.textSecondary },
  badge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.md },
  badgeText: { fontSize: 9, fontWeight: '500' },
})

export default function EmployerDashboardScreen() {
  const { employer } = useSession()
  const { data } = useQuery({
    queryKey: ['employer-dashboard', employer?.id],
    queryFn: () => fetch('/api/employer/treasury').then(r => r.json()),
    enabled: !!employer?.id,
  })

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={s.title}>Dashboard</Text>

        <View style={s.kpiGrid}>
          <KPI label="Treasury" value={`$${(Number(data?.balance ?? 0) / 1e6).toFixed(0)}`} />
          <KPI label="Released today" value="$2,840" sub="10 of 12 checked in" />
          <KPI label="Staff checked in" value="10/12" />
          <KPI label="Pending" value="10" sub="5 refund · 3 leave · 2 adv." />
        </View>

        <Text style={s.sectionLabel}>Pending requests</Text>
        <RequestRow icon="🧾" title="Refund — Amaka Johnson" sub="Transport · $45.00" badge="review" />
        <RequestRow icon="🏖" title="Leave — Emeka Badmus" sub="Annual · Jun 24–28 · 5 days" badge="review" />
        <RequestRow icon="📈" title="Advance — Sade Olawale" sub="$675 · 50% of monthly" badge="review" />
        <RequestRow icon="⛔" title="Termination — Kola" sub="Effective Jul 1 · Letter uploaded" badge="ready" />
        <RequestRow icon="⚠️" title="Absent — Fatima Nwosu" sub="Day 2 — salary withheld" badge="warning" />
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: colors.bgPage },
  scroll:       { padding: spacing.lg, paddingBottom: 80 },
  title:        { fontSize: fontSize.lg, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.lg },
  kpiGrid:      { flexDirection: 'row', flexWrap: 'wrap', margin: -4, marginBottom: spacing.md },
  sectionLabel: { fontSize: fontSize.xs, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: .7, marginBottom: spacing.sm, marginTop: spacing.md },
})
