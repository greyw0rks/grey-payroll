import { ArrowUpRight } from 'lucide-react'

export function Brand() {
  return <a className="brand" href="/" aria-label="Grey Payroll home"><span className="brand-mark" aria-hidden="true">G</span><span>grey<span className="brand-descriptor"> / payroll</span></span></a>
}

export function SiteHeader() {
  return <header className="site-header page-width">
    <Brand />
    <nav className="product-nav" aria-label="Product"><a href="/#how-it-works">How it works</a><a href="/#your-control">Your control</a><a href="/#questions">FAQs</a></nav>
    <nav className="account-nav" aria-label="Account"><a className="login-link" href="/login">Log in</a><a className="button button-small button-dark" href="/signup">Get started <ArrowUpRight size={16} aria-hidden="true" /></a></nav>
  </header>
}

export function SiteFooter() {
  return <footer className="site-footer page-width"><Brand /><p>Good work deserves a good payday.</p><a href="https://studio.arc.io/app/1d863f81-947e-4800-af87-326ace25ef49" target="_blank" rel="noopener noreferrer">Payroll built with Arc Studio <ArrowUpRight size={14} aria-hidden="true" /></a></footer>
}

export function PageLoading() {
  return <main className="route-message"><Brand /><p role="status">Opening Grey…</p></main>
}
