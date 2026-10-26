import { lazy, Suspense } from 'react'
import { LandingPage } from './components/site/LandingPage'
import { PageLoading } from './components/site/SiteChrome'
import { getPlatformContext } from './grey/platform'

const WorkspacePage = lazy(() => import('./components/site/WorkspacePage'))
const AuthPage = lazy(() => import('./components/site/AuthPage'))
const EmbeddedWorkspace = lazy(() => import('./components/site/WalletWorkspace'))

export default function App() {
  const path = window.location.pathname.replace(/^\/arc-module(?=\/|$)/, '').replace(/\/$/, '') || '/'
  if (path === '/app' && getPlatformContext()) return <Suspense fallback={<PageLoading />}><EmbeddedWorkspace /></Suspense>
  if (path === '/app' || path === '/payroll') {
    return <Suspense fallback={<PageLoading />}><WorkspacePage /></Suspense>
  }
  if (path === '/login' || path.startsWith('/login/') || path === '/signup' || path.startsWith('/signup/')) {
    return <Suspense fallback={<PageLoading />}><AuthPage mode={path.startsWith('/signup') ? 'signup' : 'login'} /></Suspense>
  }
  if (path !== '/') {
    return <main className="route-message"><h1>Page not found.</h1><p>Let’s get you back to Grey.</p><a className="button button-primary" href="/">Go home</a></main>
  }
  return <LandingPage />
}
