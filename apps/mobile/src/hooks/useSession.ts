import { create } from 'zustand'

type Employee = {
  id: string
  firstName: string
  lastName: string
  walletAddress: string
  monthlySalary: number
  dailyRate: string
  currency: string
  earnedThisMonth: number
}

type Employer = {
  id: string
  companyName: string
  walletAddress: string
}

type SessionStore = {
  role: 'EMPLOYEE' | 'EMPLOYER' | null
  token: string | null
  employee: Employee | null
  employer: Employer | null
  setSession: (role: 'EMPLOYEE' | 'EMPLOYER', token: string, data: Employee | Employer) => void
  clearSession: () => void
}

export const useSession = create<SessionStore>((set) => ({
  role: null,
  token: null,
  employee: null,
  employer: null,
  setSession: (role, token, data) => set({
    role, token,
    employee: role === 'EMPLOYEE' ? data as Employee : null,
    employer: role === 'EMPLOYER' ? data as Employer : null,
  }),
  clearSession: () => set({ role: null, token: null, employee: null, employer: null }),
}))
