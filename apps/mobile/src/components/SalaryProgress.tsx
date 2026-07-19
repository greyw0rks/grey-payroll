import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors, spacing, radius } from '@/lib/theme'

type Props = { earned: number; monthly: number; currency: string }

export function SalaryProgress({ earned, monthly, currency }: Props) {
  const pct = monthly > 0 ? Math.min(earned / monthly * 100, 100) : 0
  return (
    <View style={s.card}>
      <View style={s.row}>
        <View>
          <Text style={s.label}>Earned this month</Text>
          <Text style={s.bigVal}>${earned.toFixed(2)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={s.label}>Monthly total</Text>
          <Text style={s.subVal}>${monthly.toFixed(2)} {currency}</Text>
        </View>
      </View>
      <View style={s.barBg}>
        <View style={[s.barFill, { width: `${pct}%` }]} />
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  card:   { backgroundColor: '#1a1a2e', borderWidth: .5, borderColor: 'rgba(255,255,255,.08)', borderRadius: radius.xl, padding: spacing.md },
  row:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: spacing.md },
  label:  { fontSize: 9, color: 'rgba(255,255,255,.35)', marginBottom: 3 },
  bigVal: { fontSize: 20, fontWeight: '500', color: '#fff', letterSpacing: -.5 },
  subVal: { fontSize: 9, color: 'rgba(255,255,255,.35)' },
  barBg:  { height: 3, backgroundColor: 'rgba(255,255,255,.08)', borderRadius: 2 },
  barFill:{ height: 3, backgroundColor: colors.accentB, borderRadius: 2 },
})
