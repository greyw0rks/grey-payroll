'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useUser } from '@clerk/nextjs'

const NAV = [
  { id: 'home',     label: 'Home',     href: '/home' },
  { id: 'salary',   label: 'Salary',   href: '/salary' },
  { id: 'requests', label: 'Requests', href: '/my-requests' },
  { id: 'profile',  label: 'Profile',  href: '/profile' },
]

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function EmployeeShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user } = useUser()
  const active = NAV.find(n => n.href === pathname)?.id ?? 'home'

  return (
    <div className="min-h-screen flex justify-center" style={{ background: '#F4F3EE' }}>
      <div className="w-full max-w-md flex flex-col" style={{ minHeight: '100vh' }}>
        <div className="flex items-center justify-between px-5 pt-6 pb-3">
          <div>
            <p className="text-sm" style={{ color: '#8A8D91' }}>{greeting()}</p>
            <h1 className="font-display text-lg font-semibold" style={{ color: '#16181C' }}>
              {user?.firstName ?? '…'}
            </h1>
          </div>
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: '#FFFFFF' }}
          >
            <span style={{ color: '#8A8D91' }}>🔔</span>
          </div>
        </div>

        <div className="flex-1 px-5 pb-24 overflow-y-auto">
          {children}
        </div>

        <div className="fixed bottom-0 left-0 right-0 flex justify-center pointer-events-none">
          <div
            className="w-full max-w-md pointer-events-auto border-t flex"
            style={{ background: '#FFFFFF', borderColor: '#ECEBE6' }}
          >
            {NAV.map(n => (
              <Link
                key={n.id}
                href={n.href}
                className="flex-1 flex flex-col items-center gap-1 py-3"
                style={{ color: active === n.id ? '#0B3D20' : '#8A8D91' }}
              >
                <span className="text-[11px] font-medium">{n.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
