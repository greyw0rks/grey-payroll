'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'

const TABS = [
  { id: 'overview',  label: 'Overview',        href: '/dashboard' },
  { id: 'staff',     label: 'Staff',           href: '/staff' },
  { id: 'history',   label: 'Payroll history', href: '/payroll' },
  { id: 'requests',  label: 'Requests',        href: '/inbox' },
  { id: 'settings',  label: 'Settings',        href: '/settings' },
]

export function EmployerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const active = TABS.find(t =>
    t.href === pathname || (t.href !== '/dashboard' && pathname.startsWith(t.href))
  )?.id ?? 'overview'

  return (
    <div className="min-h-screen" style={{ background: '#F4F3EE' }}>
      <div className="max-w-7xl mx-auto p-4 sm:p-6">
        <div
          className="flex items-center justify-between rounded-2xl p-3 mb-6"
          style={{ background: '#FFFFFF' }}
        >
          <div className="flex items-center gap-2 px-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: '#3DDC84' }}
            >
              <span className="text-sm" style={{ color: '#0B3D20' }}>⚡</span>
            </div>
            <span className="font-display font-semibold text-base" style={{ color: '#16181C' }}>Grey</span>
          </div>

          <div className="hidden sm:flex gap-1">
            {TABS.map(t => (
              <Link
                key={t.id}
                href={t.href}
                className="text-sm font-medium px-4 py-2 rounded-full transition"
                style={
                  active === t.id
                    ? { background: '#3DDC84', color: '#0B3D20' }
                    : { color: '#8A8D91' }
                }
              >
                {t.label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <UserButton appearance={{ elements: { avatarBox: 'w-9 h-9' } }} />
          </div>
        </div>

        <div className="flex sm:hidden gap-2 mb-4 overflow-x-auto scrollbar-none">
          {TABS.map(t => (
            <Link
              key={t.id}
              href={t.href}
              className="text-sm font-medium px-4 py-2 rounded-full whitespace-nowrap"
              style={
                active === t.id
                  ? { background: '#3DDC84', color: '#0B3D20' }
                  : { background: '#FFFFFF', color: '#8A8D91' }
              }
            >
              {t.label}
            </Link>
          ))}
        </div>

        {children}
      </div>
    </div>
  )
}
