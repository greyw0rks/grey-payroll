import React from 'react'
import type { View } from '../App'

type Props = { active: View; onNavigate: (v: View) => void }

const NAV: { id: View; label: string; icon: string; badge?: number }[] = [
  { id: 'dashboard', label: 'Overview',    icon: '⊞' },
  { id: 'staff',     label: 'All staff',   icon: '👥', badge: 12 },
  { id: 'treasury',  label: 'Treasury',    icon: '💰' },
  { id: 'requests',  label: 'Requests',    icon: '📥', badge: 10 },
  { id: 'payroll',   label: 'Payroll',     icon: '📊' },
  { id: 'settings',  label: 'Settings',    icon: '⚙' },
]

export function Sidebar({ active, onNavigate }: Props) {
  return (
    <div className="sidebar">
      <div className="sidebar-head">Workspace</div>
      {NAV.map(({ id, label, icon, badge }) => (
        <div
          key={id}
          className={`s-item ${active === id ? 'active' : ''}`}
          onClick={() => onNavigate(id)}
        >
          <span>{icon}</span>
          {label}
          {badge !== undefined && <span className="s-badge">{badge}</span>}
        </div>
      ))}
    </div>
  )
}
