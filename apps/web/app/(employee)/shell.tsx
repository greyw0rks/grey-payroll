'use client'
import { CompanyShell } from '@/components/ui/CompanyShell'
export function EmployeeShell({ children, companyName }: { children: React.ReactNode; companyName: string }) {
  return <CompanyShell companyName={companyName} role="employee">{children}</CompanyShell>
}
