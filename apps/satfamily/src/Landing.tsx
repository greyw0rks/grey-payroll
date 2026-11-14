import { useState, type MouseEvent } from 'react';
import '@fontsource-variable/inter';
import '@fontsource-variable/sora';
import { GreyMark } from './Brand';
import './landing.css';

export type PageNavigation = (path: string) => void;
export function internalLink(event: MouseEvent<HTMLAnchorElement>, navigate: PageNavigation, path: string) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault(); navigate(path);
}
export function Arrow({ down = false }: { down?: boolean }) {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d={down ? 'M10 3v13m0 0 5-5m-5 5-5-5' : 'M5 15 15 5m-7 0h7v7'} /></svg>;
}
function Check() { return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-9" /></svg>; }
export function Brand({ navigate }: { navigate: PageNavigation }) {
  return <a className="marketing-brand" href="/" onClick={event => internalLink(event, navigate, '/')} aria-label="GreyFinance home"><GreyMark /><strong>grey</strong><small>/ finance</small></a>;
}
const stages = [
  { title: 'Bring your team.', copy: 'Connect your company wallet. Give each teammate the access and spending limit they need.', label: 'Company workspace', state: 'A clear role for everyone', status: 'Ready to request', actor: 'Company owner', action: 'Sets the spending policy' },
  { title: 'Make the request.', copy: 'A teammate submits a Lightning invoice. The amount, purpose, and deadline stay in view.', label: 'Expense request', state: 'An invoice with a purpose', status: 'Awaiting review', actor: 'Team member', action: 'Requests a design subscription' },
  { title: 'Give the go-ahead.', copy: 'Someone else reviews the expense. Limits are checked before the payment can go ahead.', label: 'Independent approval', state: 'Reviewed before money moves', status: 'Approved to pay', actor: 'Finance reviewer', action: 'Checks the request and budget' },
  { title: 'Know it arrived.', copy: 'Confirm the payment once. Keep a verified receipt and a record your whole finance team can return to.', label: 'Payment record', state: 'A receipt you can check', status: 'Recorded payment', actor: 'Company wallet', action: 'Returns the payment proof' },
] as const;
const questions = [
  { title: 'What is GreyFinance?', answer: 'A Bitcoin treasury workspace for small companies and teams. Connect a Lightning wallet, receive payments, manage expenses, set spending limits, and keep verified receipts in one place.' },
  { title: 'Who controls the company wallet?', answer: 'Your company keeps its wallet with its wallet provider. GreyFinance stores an encrypted connection with the permissions you grant. The server checks team approvals and limits; set a spending budget at your wallet provider too. These controls are not cryptographic multisignature.' },
  { title: 'Who can approve an expense?', answer: 'An owner or finance reviewer can approve a teammate’s expense. The requester cannot approve or pay their own request. Employees see their own expenses and allowance; finance can review the company records.' },
  { title: 'What if the payment result is unclear?', answer: 'The request stays reserved and cannot be paid again. GreyFinance checks the original wallet for a matching payment proof. A verified result becomes a receipt; an uncertain result stays visible for review.' },
  { title: 'Can I try it before connecting a wallet?', answer: 'Yes. Open the workspace and try with a temporary Nostr identity. You can create a company and explore the controls. For a complete payment rehearsal, the open-source local setup includes two real Lightning wallets on a private Bitcoin test network. Those test sats have no monetary value.' },
  { title: 'What does it cost?', answer: 'GreyFinance is open source under the MIT license and free to run. Your wallet provider may charge service or Lightning routing fees. Company budgets currently track invoice amounts; routing fees are controlled by the wallet provider.' },
];

function TreasuryIllustration() {
  return <figure className="marketing-treasury-scene" aria-label="Illustration of a company Bitcoin treasury">
    <div className="marketing-scene-orbit" aria-hidden="true"><span /><span /></div>
    <div className="marketing-scene-card marketing-scene-back" aria-hidden="true" />
    <div className="marketing-scene-card marketing-scene-middle" aria-hidden="true" />
    <div className="marketing-scene-card marketing-scene-front">
      <div className="marketing-scene-heading"><strong><GreyMark size={26} /> grey</strong><span>TEAM TREASURY</span></div>
      <p>One workspace. A clear next step.</p>
      <div className="marketing-scene-amount">12,000 <small>sats</small><svg viewBox="0 0 40 48" aria-hidden="true"><path d="M25 2 6 27h14l-4 19 20-27H22z" /></svg></div>
      <div className="marketing-scene-footer"><span>Requested → Approved → Paid</span><span>₿</span></div>
    </div>
    <div className="marketing-floating-receipt" aria-hidden="true"><span><Check /></span><div><strong>Every team request in view.</strong><small>One payment. One clear record.</small></div></div>
    <figcaption><span>Your team’s Bitcoin, in good order.</span><small>Illustration · no funds move</small></figcaption>
  </figure>;
}

export default function Landing({ navigate }: { navigate: PageNavigation }) {
  const [activeStage, setActiveStage] = useState(0);
  const [mobileMenu, setMobileMenu] = useState(false);
  const stage = stages[activeStage];
  const openWorkspace = (event: MouseEvent<HTMLAnchorElement>) => internalLink(event, navigate, '/app');
  return <div className="marketing-page">
    <a className="marketing-skip-link" href="#main-content">Skip to content</a>
    <header className="marketing-header marketing-width">
      <Brand navigate={navigate} />
      <nav className="marketing-product-nav" aria-label="Product"><a href="#how-it-works">How it works</a><a href="#your-control">Your control</a><a href="#questions">FAQs</a></nav>
      <nav className="marketing-account-nav" aria-label="Account"><a href="/app" onClick={openWorkspace}>Sign in</a><a className="marketing-button marketing-button-small marketing-button-dark" href="/app" onClick={openWorkspace}>Open workspace <Arrow /></a><button className="marketing-menu-button" aria-expanded={mobileMenu} aria-controls="landing-mobile-menu" aria-label={mobileMenu ? 'Close product menu' : 'Open product menu'} onClick={() => setMobileMenu(!mobileMenu)}><span /><span /></button></nav>
    </header>
    {mobileMenu && <nav className="marketing-mobile-menu marketing-width" id="landing-mobile-menu" aria-label="Mobile product navigation">{[['How it works', '#how-it-works'], ['Your control', '#your-control'], ['FAQs', '#questions']].map(([label, href]) => <a key={href} href={href} onClick={() => setMobileMenu(false)}>{label}<Arrow /></a>)}<a href="/app" onClick={openWorkspace}>Sign in to your workspace<Arrow /></a></nav>}
    <main id="main-content" tabIndex={-1}>
      <section className="marketing-hero marketing-width" aria-labelledby="hero-title"><div className="marketing-hero-copy"><p className="marketing-eyebrow">Bitcoin treasury for teams</p><h1 id="hero-title">Good work.<br /><span>Clear spending.</span></h1><p>Your company’s Bitcoin, and the people behind it.<br className="marketing-desktop-break" /> Team requests, approvals, and receipts in one place.</p><div className="marketing-hero-actions"><a className="marketing-button marketing-button-primary" href="/app" onClick={openWorkspace}>Start with Grey <Arrow /></a><a className="marketing-text-action" href="#how-it-works">See how it works <Arrow down /></a></div><p className="marketing-hero-note">Open source. Company-controlled wallets. Built for real teams.</p></div><TreasuryIllustration /></section>
      <div className="marketing-facts marketing-width" aria-label="Product facts"><span><i aria-hidden="true">₿</i> Bitcoin, at Lightning speed</span><span><i aria-hidden="true">✓</i> Independently approved</span><span><i aria-hidden="true">↗</i> Verifiable payment records</span></div>
      <section id="how-it-works" className="marketing-workflow marketing-width" aria-labelledby="workflow-title"><div className="marketing-section-heading"><h2 id="workflow-title">From a team request<br />to a clear receipt.</h2><p>Fewer moving parts.<br />A considered decision at every step.</p></div><div className="marketing-workflow-layout"><div className="marketing-workflow-steps">{stages.map((item, index) => <button key={item.title} type="button" className={activeStage === index ? 'is-active' : ''} aria-pressed={activeStage === index} onClick={() => setActiveStage(index)}><span>{index + 1}</span><span><strong>{item.title}</strong><small>{item.copy}</small></span><Arrow /></button>)}</div><div className="marketing-payroll-preview" aria-live="polite"><div className="marketing-preview-heading"><GreyMark size={28} /><strong>Baobab Studio</strong><small>Illustrative</small></div><div className="marketing-preview-total"><span>{stage.label}</span><strong>12,000 <small>sats</small></strong><p>Design tools · monthly subscription</p></div><div className="marketing-sample-person"><span>{activeStage === 0 ? 'AO' : activeStage === 1 ? 'TA' : activeStage === 2 ? 'MD' : '₿'}</span><span><strong>{stage.actor}</strong><small>{stage.action}</small></span><b className={`marketing-demo-status stage-${activeStage}`}>{stage.status}</b></div><div className="marketing-preview-policy"><span>Company budget</span><strong>Within the monthly limit</strong></div><div className="marketing-preview-policy"><span>Approval</span><strong>{activeStage < 2 ? 'Independent review required' : 'A different teammate reviewed it'}</strong></div><div className="marketing-preview-state"><span><Check />{stage.state}</span><span>Step {activeStage + 1} / 4</span></div><p>Workflow illustration. No payment has been sent.</p></div></div></section>
      <section id="your-control" className="marketing-control marketing-width" aria-labelledby="control-title"><div className="marketing-control-intro"><h2 id="control-title">Your team.<br />Your final say.</h2><p>Good tools bring clarity.<br />Your company decides when money moves.</p><a className="marketing-text-action" href="/app" onClick={openWorkspace}>Explore the workspace <Arrow /></a></div><div className="marketing-control-features"><article><span>01</span><div><h3>A wallet your company controls.</h3><p>Connect an existing Lightning wallet with only the permissions you need. Your seed phrase stays with your wallet.</p></div></article><article><span>02</span><div><h3>A second set of eyes.</h3><p>Independent approvals, employee allowances, and monthly budgets make the spending policy part of every payment.</p></div></article><article><span>03</span><div><h3>A record you can return to.</h3><p>Track each request through approval and settlement. Verify the receipt, review the audit trail, and export your ledger.</p></div></article></div></section>
      <section className="marketing-proof marketing-width" aria-labelledby="proof-title"><div><p className="marketing-eyebrow">Working from end to end</p><h2 id="proof-title">Built. Paid. Verified.</h2><p>A company expense and an incoming payment completed through the public app, real Lightning wallets, and independent receipt checks.</p><a className="marketing-text-action" href="https://github.com/greyw0rks/grey-payroll/blob/main/docs/evidence/greyfinance-convex-regtest.json" target="_blank" rel="noopener noreferrer">View the payment evidence <Arrow /></a></div><div className="marketing-proof-results"><div><span>Company expense</span><strong>150 <small>sats</small></strong><span className="marketing-proof-check"><Check /> Verified outgoing payment</span></div><div><span>Client payment</span><strong>100 <small>sats</small></strong><span className="marketing-proof-check"><Check /> Verified incoming payment</span></div><p>Builder-controlled demonstration on a private Bitcoin test network. Test sats have no monetary value.</p></div></section>
      <section id="questions" className="marketing-faq marketing-width" aria-labelledby="faq-title"><h2 id="faq-title">A few things<br />you might ask.</h2><div>{questions.map(question => <details key={question.title}><summary>{question.title}<span aria-hidden="true">＋</span></summary><p>{question.answer}</p></details>)}</div></section>
      <section className="marketing-closing marketing-width"><h2>Make room for<br />better team spending.</h2><a className="marketing-button marketing-button-dark" href="/app" onClick={openWorkspace}>Open your workspace <Arrow /></a></section>
    </main>
    <footer className="marketing-footer marketing-width"><div><Brand navigate={navigate} /><p>A clearer way for teams to use Bitcoin.</p></div><nav aria-label="Footer"><a href="/security" onClick={event => internalLink(event, navigate, '/security')}>Security</a><a href="/privacy" onClick={event => internalLink(event, navigate, '/privacy')}>Privacy</a><a href="/terms" onClick={event => internalLink(event, navigate, '/terms')}>Terms</a><a href="https://github.com/greyw0rks/grey-payroll" target="_blank" rel="noopener noreferrer">Open source <Arrow /></a></nav><small>© {new Date().getFullYear()} GreyLabs · MIT licensed</small></footer>
  </div>;
}
