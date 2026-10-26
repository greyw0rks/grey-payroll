'use client'
import { CompanyShell } from '@/components/ui/CompanyShell'
export function EmployerShell({ children, companyName }: { children: React.ReactNode; companyName: string }) {
  return <CompanyShell companyName={companyName} role="employer">{children}</CompanyShell>
}
