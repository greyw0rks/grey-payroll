import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors, radius } from '@/lib/theme'

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export function WeekStrip() {
  const todayDow = new Date().getDay() // 0=Sun
  const adjustedDow = todayDow === 0 ? 6 : todayDow - 1 // Mon=0

  return (
    <View style={s.row}>
      {DAYS.map((d, i) => {
        const isPast = i < adjustedDow
        const isToday = i === adjustedDow
        return (
          <View key={i} style={[s.day, isPast && s.past, isToday && s.today]}>
            <Text style={[s.dayName, isToday && s.todayText]}>{d}</Text>
            {isPast && <Text style={s.check}>✓</Text>}
            {isToday && <Text style={[s.check, s.todayText]}>?</Text>}
          </View>
        )
      })}
    </View>
  )
}

const s = StyleSheet.create({
  row:      { flexDirection: 'row', gap: 4, marginBottom: 12 },
  day:      { flex: 1, height: 30, borderRadius: radius.sm, backgroundColor: 'rgba(255,255,255,.04)', alignItems: 'center', justifyContent: 'center' },
  past:     { backgroundColor: '#1a2d5a' },
  today:    { backgroundColor: colors.accentB },
  dayName:  { fontSize: 7, color: 'rgba(255,255,255,.3)' },
  check:    { fontSize: 9, color: colors.ciIcon },
  todayText:{ color: '#fff' },
})
