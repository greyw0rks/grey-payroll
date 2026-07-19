import React, { useState } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Alert, ActivityIndicator, Dimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { colors, spacing, radius, fontSize } from '@/lib/theme'
import { useSession } from '@/hooks/useSession'
import { useCheckIn } from '@/hooks/useCheckIn'
import { WeekStrip } from '@/components/WeekStrip'
import { SalaryProgress } from '@/components/SalaryProgress'

export default function EmployeeHomeScreen() {
  const { employee } = useSession()
  const { checkIn, isCheckedIn, loading, checkInStatus } = useCheckIn()
  const [pressed, setPressed] = useState(false)

  async function handleCheckIn() {
    setPressed(true)
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    const result = await checkIn()
    if (result.ok) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      Alert.alert('Checked in!', `$${result.amount} USDC will be released to your wallet today.`)
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      Alert.alert('Check-in failed', result.error)
    }
    setPressed(false)
  }

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.greeting}>{greeting}, {employee?.firstName ?? '—'}</Text>
          <Text style={s.subGreeting}>{new Date().toDateString()} · Check-in closes 10:00 AM</Text>
        </View>

        {/* Check-in card */}
        <View style={s.checkInCard}>
          <Text style={s.ciTimer}>Window closes 10:00 AM</Text>

          <TouchableOpacity
            style={[s.ciButton, isCheckedIn && s.ciButtonDone]}
            onPress={handleCheckIn}
            disabled={isCheckedIn || loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={colors.ciIcon} />
            ) : (
              <Text style={s.ciIcon}>{isCheckedIn ? '✓' : '☉'}</Text>
            )}
          </TouchableOpacity>

          <Text style={s.ciLabel}>{isCheckedIn ? 'Checked in' : 'Tap to check in'}</Text>
          <Text style={s.ciSub}>
            {isCheckedIn
              ? `${checkInStatus === 'ON_TIME' ? 'On time' : 'Late'} · USDC release queued`
              : `Releases $${employee?.dailyRate ?? '—'} USDC to your wallet`}
          </Text>
        </View>

        {/* Week strip */}
        <WeekStrip />

        {/* Salary progress */}
        <SalaryProgress
          earned={employee?.earnedThisMonth ?? 0}
          monthly={employee?.monthlySalary ?? 0}
          currency={employee?.currency ?? 'USDC'}
        />
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe:           { flex: 1, backgroundColor: colors.bgPage },
  scroll:         { padding: spacing.lg, paddingBottom: 80 },
  header:         { marginBottom: spacing.lg },
  greeting:       { fontSize: fontSize.md, fontWeight: '600', color: colors.textPrimary, marginBottom: 2 },
  subGreeting:    { fontSize: fontSize.xs, color: colors.textSecondary },

  checkInCard: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: 'rgba(91,156,246,.2)',
    borderRadius: radius.xl,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  ciTimer:    { fontSize: fontSize.xs, color: 'rgba(91,156,246,.7)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: spacing.md },
  ciButton: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: colors.ciOuter, borderWidth: 1.5, borderColor: colors.ciBorder,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md,
  },
  ciButtonDone: { backgroundColor: '#1a3a1a', borderColor: '#3d8a3d' },
  ciIcon:     { fontSize: 32, color: colors.ciIcon },
  ciLabel:    { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: .5 },
  ciSub:      { fontSize: fontSize.xs, color: 'rgba(255,255,255,.3)', marginTop: 4 },
})
