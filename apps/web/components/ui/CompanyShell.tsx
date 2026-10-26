'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'

const employerNavigation = [
  { href: '/dashboard', label: 'Overview', icon: 'overview' },
  { href: '/staff', label: 'Employees', icon: 'people' },
  { href: '/inbox', label: 'Requests', icon: 'requests' },
  { href: '/payroll', label: 'Payroll history', icon: 'history' },
  { href: '/arc-payroll', label: 'Arc payroll', icon: 'payroll' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
]
const employeeNavigation = [
  { href: '/home', label: 'Overview', icon: 'overview' },
  { href: '/salary', label: 'My salary', icon: 'payroll' },
  { href: '/my-requests', label: 'My requests', icon: 'requests' },
  { href: '/profile', label: 'My profile', icon: 'people' },
]
function NavigationIcon({ kind }: { kind: string }) {
  const paths: Record<string, React.ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2" /></>,
    requests: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h4" /></>,
    history: <path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2" />,
    payroll: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 9h18M15 14h3M3 5l13-3" /></>,
    settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="var(--grey-ground)" /><circle cx="15" cy="17" r="3" fill="var(--grey-ground)" /></>,
  }
  return <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[kind]}</svg>
}
export function CompanyShell({ children, companyName, role }: { children: React.ReactNode; companyName: string; role: 'employer' | 'employee' }) {
  const pathname = usePathname()
  const navigation = role === 'employer' ? employerNavigation : employeeNavigation
  return <div className="grey-app">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="company-header"><Link href={role === 'employer' ? '/dashboard' : '/home'} className="company-brand" aria-label={`${companyName} by Grey, overview`}><span className="company-monogram" aria-hidden="true">{companyName.slice(0, 1).toUpperCase()}</span><span className="company-name">{companyName} <span className="company-by">by Grey</span></span></Link><div className="company-account"><span className="account-role">{role === 'employer' ? 'Employer' : 'Employee'} workspace</span><UserButton appearance={{ elements: { avatarBox: 'w-9 h-9' } }} /></div></header>
    <div className="company-layout"><aside className="company-sidebar"><nav aria-label={`${role === 'employer' ? 'Company' : 'Employee'} navigation`} className="company-navigation">{navigation.map(item => {
      const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
      return <Link key={item.href} href={item.href} className={`company-nav-link${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}><NavigationIcon kind={item.icon} /><span>{item.label}</span></Link>
    })}</nav><div className="company-sidebar-note"><span className="sidebar-grey">Grey</span><p>{role === 'employer' ? 'Your team. Your payroll.' : 'Your work. Your earnings.'}</p></div></aside><main id="main-content" className="company-content">{children}</main></div>
  </div>
}
