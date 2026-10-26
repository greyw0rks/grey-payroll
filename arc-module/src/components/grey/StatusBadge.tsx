import React from 'react'
import { CheckCircle, Clock, XCircle, AlertCircle, HelpCircle } from 'lucide-react'

export type Status = 'pending' | 'confirmed' | 'failed' | 'replaced' | 'unknown'

interface StatusBadgeProps {
  status: Status
}

const config: Record<Status, { label: string; icon: React.ReactNode; cls: string }> = {
  pending: {
    label: 'Pending',
    icon: <Clock size={13} />,
    cls: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  confirmed: {
    label: 'Confirmed',
    icon: <CheckCircle size={13} />,
    cls: 'bg-green-50 text-green-700 border-green-200',
  },
  failed: {
    label: 'Failed',
    icon: <XCircle size={13} />,
    cls: 'bg-red-50 text-red-700 border-red-200',
  },
  replaced: {
    label: 'Replaced',
    icon: <AlertCircle size={13} />,
    cls: 'bg-slate-50 text-slate-600 border-slate-200',
  },
  unknown: {
    label: 'Unknown',
    icon: <HelpCircle size={13} />,
    cls: 'bg-slate-50 text-slate-500 border-slate-200',
  },
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const { label, icon, cls } = config[status] ?? config.unknown
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}
    >
      {icon}
      {label}
    </span>
  )
}
