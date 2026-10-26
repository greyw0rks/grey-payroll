'use client'

import Link from 'next/link'
import { useState } from 'react'

type LandingPageProps = {
  workspaceHref: string | null
}

const team = [
  { name: 'Alex Morgan', role: 'Design', initials: 'AM', amount: '2,400.00' },
  { name: 'Sam Rivera', role: 'Engineering', initials: 'SR', amount: '3,200.00' },
  { name: 'Jo Ellis', role: 'Operations', initials: 'JE', amount: '1,800.00' },
]

const stages = [
  { title: 'Bring your team.', copy: 'Add recipient wallets and exact USDC amounts. Every detail stays in view.', state: '3 recipients to review' },
  { title: 'Make it ready.', copy: 'Fund your employer balance and review the complete payroll before you sign.', state: 'Review the total, then fund' },
  { title: 'Give the go-ahead.', copy: 'Approve with your wallet. The whole batch succeeds together or reverts together.', state: 'Only your wallet can approve' },
  { title: 'Know it arrived.', copy: 'Reconcile confirmed payments with onchain receipts and export the record.', state: 'Receipts show the outcome' },
] as const

const previewTitles = ['Your next payday', 'Ready for funding', 'Ready for your signature', 'Your payment record'] as const
type StageIndex = 0 | 1 | 2 | 3

const questions = [
  { title: 'What is Grey Finance?', answer: 'Grey is a company workspace for payroll, employees, attendance and employer-approved USDC payments on Arc.' },
  { title: 'Who approves a payment?', answer: 'Your connected employer wallet signs every transaction. Grey never receives your treasury key or signs payroll for you.' },
  { title: 'What happens if a payment fails?', answer: 'A payroll run is atomic: if a recipient transfer fails, the entire batch reverts. Stable run IDs and verified receipts help prevent duplicate payment.' },
  { title: 'Can I rehearse before using real funds?', answer: 'Yes. Arc Testnet remains available for rehearsals. Arc Mainnet is a separate network and uses real USDC.' },
]

function Arrow({ down = false }: { down?: boolean }) {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d={down ? 'M10 3v13m0 0 5-5m-5 5-5-5' : 'M5 15 15 5m-7 0h7v7'} /></svg>
}

function Check() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-9" /></svg>
}

function Brand() {
  return <Link className="marketing-brand" href="/" aria-label="Grey Finance home"><span aria-hidden="true">G</span><strong>grey</strong><small>/ finance</small></Link>
}

export function LandingPage({ workspaceHref }: LandingPageProps) {
  const [activeStage, setActiveStage] = useState<StageIndex>(0)
  const primaryHref = workspaceHref ?? '/sign-up'
  const primaryLabel = workspaceHref ? 'Open workspace' : 'Start with Grey'

  return <div className="marketing-page">
    <a className="marketing-skip-link" href="#main-content">Skip to content</a>
    <header className="marketing-header marketing-width">
      <Brand />
      <nav className="marketing-product-nav" aria-label="Product">
        <a href="#how-it-works">How it works</a>
        <a href="#your-control">Your control</a>
        <a href="#questions">FAQs</a>
      </nav>
      <nav className="marketing-account-nav" aria-label="Account">
        {!workspaceHref && <Link href="/sign-in">Sign in</Link>}
        <Link className="marketing-button marketing-button-small marketing-button-dark" href={primaryHref}>{primaryLabel} <Arrow /></Link>
      </nav>
    </header>

    <main id="main-content">
      <section className="marketing-hero marketing-width" aria-labelledby="hero-title">
        <div className="marketing-hero-copy">
          <p className="marketing-eyebrow">Company payroll on Arc</p>
          <h1 id="hero-title">Good work.<br /><span>Paid well.</span></h1>
          <p>Run your company and pay your people in USDC.<br />One clear workspace. Every wallet in reach.</p>
          <div className="marketing-hero-actions">
            <Link className="marketing-button marketing-button-primary" href={primaryHref}>{primaryLabel} <Arrow /></Link>
            <a className="marketing-text-action" href="#how-it-works">See how it works <Arrow down /></a>
          </div>
        </div>

        <figure className="marketing-payroll-scene" aria-label="Illustrative payroll for three recipient wallets">
          <div className="marketing-scene-card marketing-scene-back" aria-hidden="true" />
          <div className="marketing-scene-card marketing-scene-middle" aria-hidden="true" />
          <div className="marketing-scene-card marketing-scene-front">
            <div className="marketing-scene-heading"><strong>grey</strong><span>PAYROLL ON ARC</span></div>
            <p>Team payroll</p>
            <div className="marketing-scene-amount">7,400.00 <small>USDC</small></div>
            <div className="marketing-scene-footer"><span>3 recipients</span><span>One approval</span></div>
          </div>
          <figcaption>One payday. A whole team.<small>Illustrative payroll</small></figcaption>
        </figure>
      </section>

      <div className="marketing-facts marketing-width" aria-label="Product facts">
        <span><i aria-hidden="true">$</i> Native USDC on Arc</span>
        <span><i aria-hidden="true">✓</i> Employer approved</span>
        <span><i aria-hidden="true">↗</i> Onchain payment records</span>
      </div>

      <section id="how-it-works" className="marketing-workflow marketing-width" aria-labelledby="workflow-title">
        <div className="marketing-section-heading">
          <h2 id="workflow-title">From your desk<br />to their wallets.</h2>
          <p>A payday with fewer moving parts.<br />A clear decision at every step.</p>
        </div>
        <div className="marketing-workflow-layout">
          <div className="marketing-workflow-steps">
            {stages.map((stage, index) => <button type="button" key={stage.title} className={activeStage === index ? 'is-active' : ''} aria-pressed={activeStage === index} onClick={() => setActiveStage(index as StageIndex)}>
              <span>{index + 1}</span><span><strong>{stage.title}</strong><small>{stage.copy}</small></span><Arrow />
            </button>)}
          </div>
          <div className="marketing-payroll-preview" aria-live="polite">
            <div className="marketing-preview-heading"><span>G</span><strong>Team payroll</strong><small>Illustrative</small></div>
            <div className="marketing-preview-total"><span>{previewTitles[activeStage]}</span><strong>7,400<span>.00</span> <small>USDC</small></strong></div>
            <div>{team.map((person) => <div className="marketing-sample-person" key={person.name}><span>{person.initials}</span><span><strong>{person.name}</strong><small>{person.role}</small></span><b>{person.amount}<small> USDC</small></b></div>)}</div>
            <div className="marketing-preview-state"><span><Check /> {stages[activeStage].state}</span><span>Step {activeStage + 1} / 4</span></div>
            <p>Example amounts and people. No payment has been sent.</p>
          </div>
        </div>
      </section>

      <section id="your-control" className="marketing-control marketing-width" aria-labelledby="control-title">
        <div className="marketing-control-intro"><h2 id="control-title">Your payroll.<br />Your final say.</h2><p>Good tools bring clarity.<br />The decision stays with you.</p><Link className="marketing-text-action" href={primaryHref}>Explore the workspace <Arrow /></Link></div>
        <div className="marketing-control-features">
          <article><span aria-hidden="true">01</span><div><h3>You hold the keys.</h3><p>Your wallet approves payments from your funded balance. You control when money moves.</p></div></article>
          <article><span aria-hidden="true">02</span><div><h3>The whole team, together.</h3><p>Run an atomic payroll batch. Every transfer succeeds, or the entire batch reverts.</p></div></article>
          <article><span aria-hidden="true">03</span><div><h3>A record you can return to.</h3><p>Stable run IDs, transaction recovery and verified receipts help you track each payday.</p></div></article>
        </div>
      </section>

      <section id="questions" className="marketing-faq marketing-width" aria-labelledby="faq-title">
        <h2 id="faq-title">A few things<br />you might ask.</h2>
        <div>{questions.map((question) => <details key={question.title}><summary>{question.title}<span aria-hidden="true">＋</span></summary><p>{question.answer}</p></details>)}</div>
      </section>

      <section className="marketing-closing marketing-width"><h2>Make room for<br />a better payday.</h2><Link className="marketing-button marketing-button-dark" href={primaryHref}>{primaryLabel} <Arrow /></Link></section>
    </main>

    <footer className="marketing-footer marketing-width"><Brand /><p>Good work deserves a good payday.</p><a href="https://studio.arc.io/app/1d863f81-947e-4800-af87-326ace25ef49" target="_blank" rel="noopener noreferrer">Payroll built with Arc Studio <Arrow /></a></footer>
  </div>
}
