import React, { useState } from 'react'
import './styles.css'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { StatusBar } from './components/StatusBar'
import { DashboardView } from './screens/DashboardView'
import { StaffView } from './screens/StaffView'
import { RequestsView } from './screens/RequestsView'
import { TreasuryView } from './screens/TreasuryView'
import { PayrollView } from './screens/PayrollView'
import { SettingsView } from './screens/SettingsView'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const qc = new QueryClient()

export type View = 'dashboard' | 'staff' | 'requests' | 'treasury' | 'payroll' | 'settings'

const VIEWS: Record<View, React.ReactNode> = {
  dashboard: <DashboardView />,
  staff:     <StaffView />,
  requests:  <RequestsView />,
  treasury:  <TreasuryView />,
  payroll:   <PayrollView />,
  settings:  <SettingsView />,
}

export default function App() {
  const [view, setView] = useState<View>('dashboard')

  return (
    <QueryClientProvider client={qc}>
      <div className="app-shell">
        <TitleBar />
        <div className="app-body">
          <Sidebar active={view} onNavigate={setView} />
          <main className="main-content">
            {VIEWS[view]}
          </main>
        </div>
        <StatusBar />
      </div>
    </QueryClientProvider>
  )
}
