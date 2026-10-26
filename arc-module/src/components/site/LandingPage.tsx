import { useState } from 'react'
import { motion, MotionConfig, useReducedMotion } from 'framer-motion'
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, FileCheck2, LockKeyhole, RotateCcw, Wallet } from 'lucide-react'
import { SiteFooter, SiteHeader } from './SiteChrome'
import { PayrollScene } from './PayrollScene'

const sampleTeam = [{ name: 'Alex Morgan', role: 'Design', initials: 'AM', amount: '2,400.00' }, { name: 'Sam Rivera', role: 'Engineering', initials: 'SR', amount: '3,200.00' }, { name: 'Jo Ellis', role: 'Operations', initials: 'JE', amount: '1,800.00' }]
const stages = [
  { title: 'Bring your team.', copy: 'Add recipient wallets and exact USDC amounts. Every detail stays in view.' },
  { title: 'Make it ready.', copy: 'Fund your employer balance and review the complete payroll before you sign.' },
  { title: 'Give the go-ahead.', copy: 'Approve with your wallet. The whole batch succeeds together or reverts together.' },
  { title: 'Know it arrived.', copy: 'Reconcile confirmed payments with onchain receipts and export the record.' },
]
const questions = [
  { title: 'What is Grey Payroll?', answer: 'Grey is a payroll workspace for sending employer-approved USDC payments to a team on Arc. Prepare recipients, fund your own contract balance, sign a payroll run and review its onchain record.' },
  { title: 'Do my team members need a Grey account?', answer: 'Recipients receive USDC in their own wallets. They do not need a Grey account to receive a payroll payment; they need a wallet address on the selected Arc network.' },
  { title: 'Who can approve a payment?', answer: 'Your connected employer wallet signs every transaction. Your Grey account helps you access the workspace; it does not authorize payments or take custody of your wallet.' },
  { title: 'What happens if a payment fails?', answer: 'A payroll run is atomic: if a recipient transfer fails, the entire run reverts. When an outcome is still pending or uncertain, check the transaction record before retrying. Grey uses a stable run ID to help prevent duplicate payroll.' },
  { title: 'Can I try it before using real funds?', answer: 'The workspace opens on Arc Testnet by default. Use testnet USDC to rehearse the flow. Arc Mainnet is a separate network and uses real USDC.' },
]

export function LandingPage() {
  const [stage, setStage] = useState(0)
  const reduce = useReducedMotion()
  return <MotionConfig reducedMotion="user"><div className="landing-page">
    <a className="skip-link" href="#main-content">Skip to content</a><SiteHeader />
    <main id="main-content">
      <section className="hero page-width" aria-labelledby="hero-title">
        <motion.div className="hero-copy" initial={false} animate={{ opacity: [0.7, 1], transform: reduce ? 'none' : ['translateY(12px)', 'translateY(0px)'] }} transition={{ duration: 0.7, ease: [0.23, 1, 0.32, 1] }}>
          <h1 id="hero-title">Good work.<br /><span>Paid well.</span></h1>
          <p>Pay your people in USDC.<br />One clear payroll. Every wallet in reach.</p>
          <div className="hero-actions"><a className="button button-primary" href="/signup">Start with Grey <ArrowUpRight size={19} aria-hidden="true" /></a><a className="text-action" href="#how-it-works">See how it works <ArrowDown size={16} aria-hidden="true" /></a></div>
        </motion.div>
        <PayrollScene />
      </section>
      <div className="product-facts page-width"><span><Wallet size={18} strokeWidth={1.5} aria-hidden="true" /> Native USDC on Arc</span><span><LockKeyhole size={18} strokeWidth={1.5} aria-hidden="true" /> Employer approved</span><span><FileCheck2 size={18} strokeWidth={1.5} aria-hidden="true" /> Onchain payment records</span></div>

      <section id="how-it-works" className="workflow-section page-width" aria-labelledby="workflow-title">
        <div className="section-heading"><h2 id="workflow-title">From your desk<br />to their wallets.</h2><p>A payday with fewer moving parts.<br />A clear decision at every step.</p></div>
        <div className="workflow-layout"><div className="workflow-steps">{stages.map((item, i) => <button key={item.title} className={`workflow-step ${stage === i ? 'is-active' : ''}`} aria-pressed={stage === i} onClick={() => setStage(i)}><span className="step-number">{i + 1}</span><span><strong>{item.title}</strong><span className="step-copy">{item.copy}</span></span><ArrowUpRight size={20} aria-hidden="true" /></button>)}</div>
          <div className="payroll-preview" aria-label="Illustrative payroll example"><div className="preview-heading"><span className="preview-brand">G</span><strong>Team payroll</strong><span className="sample-label">Illustrative</span></div><div className="preview-summary"><span>{['Your next payday', 'Ready for funding', 'Ready for your signature', 'Your payment record'][stage]}</span><strong>7,400<span>.00</span> <small>USDC</small></strong></div>
            <div className="sample-team">{sampleTeam.map((person, i) => <div key={person.name} className="sample-person"><span className={`sample-avatar avatar-${i}`}>{person.initials}</span><span className="sample-name"><strong>{person.name}</strong><span>{person.role}</span></span><span className="sample-amount">{person.amount}<small> USDC</small></span></div>)}</div>
            <div className="preview-state" role="status"><span><Check size={17} aria-hidden="true" /> {['3 recipients to review', 'Review the total, then fund', 'Only your wallet can approve', 'Receipts show the outcome'][stage]}</span><span>Step {stage + 1} / 4</span></div><p className="sample-explainer">Example amounts and people. No payment has been sent.</p>
          </div>
        </div>
      </section>

      <section id="your-control" className="control-section page-width" aria-labelledby="control-title"><div className="control-intro"><h2 id="control-title">Your payroll.<br />Your final say.</h2><p>Good tools bring clarity.<br />The decision stays with you.</p><a className="text-action" href="/app">Explore the workspace <ArrowUpRight size={18} aria-hidden="true" /></a></div><div className="control-features"><article><LockKeyhole size={25} strokeWidth={1.5} aria-hidden="true" /><div><h3>You hold the keys.</h3><p>Your wallet approves payments from your funded balance. You control when money moves.</p></div></article><article><Check size={25} strokeWidth={1.5} aria-hidden="true" /><div><h3>The whole team, together.</h3><p>Up to 50 recipients in an atomic payroll run. Every transfer succeeds, or the batch reverts.</p></div></article><article><RotateCcw size={25} strokeWidth={1.5} aria-hidden="true" /><div><h3>A record you can return to.</h3><p>Stable run IDs, transaction recovery and verified receipts help you track each payday.</p></div></article></div></section>

      <section id="questions" className="faq-section page-width" aria-labelledby="faq-title"><h2 id="faq-title">A few things<br />you might ask.</h2><div className="faq-list">{questions.map(q => <details key={q.title}><summary>{q.title}<ChevronDown size={19} aria-hidden="true" /></summary><p>{q.answer}</p></details>)}</div></section>
      <section className="closing-section page-width"><h2>Make room for<br />a better payday.</h2><a className="button button-dark" href="/signup">Get started <ArrowRight size={19} aria-hidden="true" /></a></section>
    </main><SiteFooter />
  </div></MotionConfig>
}
