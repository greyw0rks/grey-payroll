import { redirect } from 'next/navigation'
import { getEmployee } from '@/lib/company-data'
import { EmployeeShell } from './shell'
export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const employee = await getEmployee()
  if (!employee) redirect('/register')
  if (employee.status !== 'ACTIVE') return <main className="account-unavailable"><h1>Your account is inactive</h1><p>Contact {employee.employer.companyName} to restore access.</p></main>
  return <EmployeeShell companyName={employee.employer.companyName}>{children}</EmployeeShell>
}
