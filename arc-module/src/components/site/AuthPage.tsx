import { Component, type ReactNode } from 'react'
import { ClerkProvider, SignIn, SignUp } from '@clerk/react'
import { ArrowLeft, ArrowUpRight, Check, Wallet } from 'lucide-react'
import { Brand } from './SiteChrome'

class AccountBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <div className="account-unavailable" role="alert"><h2>We couldn’t open account access.</h2><p>Please reload the page to try again.</p><button className="button button-dark" onClick={() => window.location.reload()}>Try again</button><a href="/">Back to Grey</a></div> : this.props.children
  }
}

export default function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
  const signup = mode === 'signup'
  return <div className="auth-page">
    <aside className="auth-story"><Brand /><div><h1>A better payday<br />starts here.</h1><p>Your people do the work.<br />Give them a payday that works, too.</p><div className="auth-payroll-note"><Wallet size={28} strokeWidth={1.5} aria-hidden="true" /><span>One payroll.<br /><strong>Your team’s own wallets.</strong></span></div></div><p className="auth-story-footer">Grey Payroll on Arc</p></aside>
    <main className="auth-main"><a className="back-link" href="/"><ArrowLeft size={17} aria-hidden="true" /> Back to Grey</a><div className="auth-form-wrap">
      <h2>{signup ? 'Make payday better.' : 'Welcome back.'}</h2><p>{signup ? 'Create your Grey account to get started.' : 'Log in to your Grey account.'}</p>
      {key ? <AccountBoundary><ClerkProvider publishableKey={key} signInUrl="/login" signUpUrl="/signup" appearance={{ variables: { colorPrimary: '#16181C', colorForeground: '#16181C', colorBackground: '#FFFFFF', fontFamily: 'DM Sans, sans-serif', borderRadius: '12px' }, elements: { rootBox: { width: '100%' }, cardBox: { width: '100%', boxShadow: 'none', borderRadius: '14px' }, card: { width: '100%', boxShadow: 'none', borderRadius: '14px', padding: '28px' }, header: { display: 'none' }, formFieldInput: { minHeight: '44px', fontSize: '16px' }, formButtonPrimary: { minHeight: '44px', background: '#16181C', boxShadow: 'none' } } }}>
        {signup ? <SignUp routing="path" path="/signup" signInUrl="/login" forceRedirectUrl="/app" /> : <SignIn routing="path" path="/login" signUpUrl="/signup" forceRedirectUrl="/app" />}
      </ClerkProvider></AccountBoundary> : <div className="account-unavailable"><span className="account-symbol"><Wallet size={24} strokeWidth={1.5} aria-hidden="true" /></span><h3>Account access is being configured.</h3><p>You can still open the payroll workspace and connect your employer wallet.</p><a className="button button-dark" href="/app">Open payroll <ArrowUpRight size={18} aria-hidden="true" /></a></div>}
      {!key && <p className="auth-switch">{signup ? 'Already have a Grey account?' : 'New to Grey?'} <a href={signup ? '/login' : '/signup'}>{signup ? 'Log in' : 'Create an account'}</a></p>}
      <p className="auth-wallet-note"><Check size={16} aria-hidden="true" /> Your wallet approves every payment.</p>
    </div><p className="auth-bottom">Your account organizes your work. Your wallet controls your funds.</p></main>
  </div>
}
