import { redirect } from 'next/navigation'
import { getEmployer } from '@/lib/company-data'
import { EmployerShell } from './shell'
export default async function EmployerLayout({ children }: { children: React.ReactNode }) {
  const employer = await getEmployer()
  if (!employer) redirect('/register')
  return <EmployerShell companyName={employer.companyName}>{children}</EmployerShell>
}
