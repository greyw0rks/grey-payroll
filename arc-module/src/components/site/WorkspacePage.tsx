import { lazy, Suspense, useEffect } from 'react'
import { ClerkProvider, useAuth, UserButton } from '@clerk/react'
import { Brand, PageLoading } from './SiteChrome'

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const WalletWorkspace = lazy(() => import('./WalletWorkspace'))

function AccountWorkspace() {
  const { isLoaded, isSignedIn } = useAuth()
  useEffect(() => { if (isLoaded && !isSignedIn) window.location.replace('/login') }, [isLoaded, isSignedIn])
  if (!isLoaded || !isSignedIn) return <PageLoading />
  return <><div className="workspace-account-bar page-width"><Brand /><UserButton /></div><Suspense fallback={<PageLoading />}><WalletWorkspace /></Suspense></>
}

export default function WorkspacePage() {
  if (!publishableKey) return <Suspense fallback={<PageLoading />}><WalletWorkspace /></Suspense>
  return <ClerkProvider publishableKey={publishableKey} signInUrl="/login" signUpUrl="/signup" afterSignOutUrl="/"><AccountWorkspace /></ClerkProvider>
}
