import { useState } from 'react'
import { useSession } from './useSession'
import Constants from 'expo-constants'

const API = Constants.expoConfig?.extra?.apiUrl ?? 'http://localhost:3000'

export function useCheckIn() {
  const { employee, token } = useSession()
  const [loading, setLoading] = useState(false)
  const [isCheckedIn, setIsCheckedIn] = useState(false)
  const [checkInStatus, setCheckInStatus] = useState<'ON_TIME' | 'LATE' | null>(null)

  async function checkIn(): Promise<{ ok: boolean; amount?: string; error?: string }> {
    if (!employee) return { ok: false, error: 'Not logged in' }
    setLoading(true)
    try {
      const res = await fetch(`${API}/api/employees/${employee.id}/checkin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })
      const data = await res.json()
      if (res.ok) {
        setIsCheckedIn(true)
        setCheckInStatus(data.checkIn.status)
        return { ok: true, amount: (Number(employee.dailyRate) / 1e6).toFixed(2) }
      }
      return { ok: false, error: data.error ?? 'Check-in failed' }
    } catch (e) {
      return { ok: false, error: 'Network error' }
    } finally {
      setLoading(false)
    }
  }

  return { checkIn, isCheckedIn, loading, checkInStatus }
}
