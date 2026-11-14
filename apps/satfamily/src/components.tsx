import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, CheckCircle, Clock, ShieldCheck, X } from '@phosphor-icons/react';

export const sats = (amount: number) => amount.toLocaleString('en-US');
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
export const dateLabel = (timestamp: number) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(timestamp);
export const fullDate = (timestamp: number) => new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
export const roleLabel = (role: string) => role === 'owner' ? 'Owner' : role.charAt(0).toUpperCase() + role.slice(1);

export function Avatar({ name, small = false, index = 0 }: { name: string; small?: boolean; index?: number }) {
  return <span className={`avatar ${small ? 'small' : ''} avatar-${index % 4}`} aria-label={name}>{initials(name)}</span>;
}
export function Status({ state, sample = false, label }: { state: string; sample?: boolean; label?: string }) {
  const labels: Record<string, string> = { pending: 'Needs review', approved: 'Approved', paying: 'Paying', settled: 'Paid', sample_paid: 'Sample paid', rejected: 'Declined', expired: 'Expired', unknown: 'Check payment' };
  const Icon = ['settled', 'sample_paid', 'approved'].includes(state) ? Check : state === 'rejected' ? X : Clock;
  return <span className={`status status-${state}`}><Icon size={12} weight="bold" />{sample && state !== 'sample_paid' ? 'Sample · ' : ''}{label ?? labels[state] ?? state}</span>;
}
export function Progress({ value, maximum, label }: { value: number; maximum: number; label: string }) {
  const percentage = Math.min(100, Math.max(0, maximum ? value / maximum * 100 : 0));
  return <div className="progress" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={maximum}><span style={{ width: `${percentage}%` }} /></div>;
}
export function Empty({ icon, title, copy, action }: { icon: ReactNode; title: string; copy: string; action?: ReactNode }) {
  return <div className="empty"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{copy}</p>{action}</div>;
}
export function FlowIcon({ incoming = false }: { incoming?: boolean }) {
  return <span className={`flow-icon ${incoming ? 'incoming' : ''}`}>{incoming ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}</span>;
}
export function ProofReceipt({ paymentHash, preimage, walletFingerprint, settledAt }: { paymentHash: string; preimage?: string | null; walletFingerprint?: string | null; settledAt?: number | null }) {
  const [proof, setProof] = useState<boolean | null>(null);
  const verify = async () => {
    if (!preimage || !/^[0-9a-f]{64}$/i.test(preimage)) { setProof(false); return; }
    const bytes = new Uint8Array(preimage.match(/.{2}/g)!.map(value => parseInt(value, 16)));
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
    setProof(hash === paymentHash.toLowerCase());
  };
  return <section className="proof-receipt"><div className="proof-receipt-heading"><CheckCircle size={24} weight="fill" /><span>Wallet-verified payment<small>{settledAt ? fullDate(settledAt) : 'Settlement recorded'}</small></span></div>{preimage ? <><button className="button secondary full-width" onClick={() => void verify()}><ShieldCheck size={17} />{proof === true ? 'Proof matches the payment hash' : 'Verify receipt proof'}</button>{proof === false && <p role="alert" className="proof-error">This receipt’s proof could not be verified.</p>}<details><summary>View payment proof</summary><label>Payment preimage<code>{preimage}</code></label><label>Wallet connection fingerprint<code>{walletFingerprint ?? 'Provider did not expose a connection fingerprint'}</code></label><p>Hashing the payment preimage with SHA-256 must produce the payment hash above. This is proof of payment, not a wallet private key.</p></details></> : <p className="helper">This older record has no stored preimage. Check it with the wallet before sharing a proof receipt.</p>}</section>;
}
export function Dialog({ title, description, children, onClose, wide = false }: { title: string; description?: string; children: ReactNode; onClose(): void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const el = ref.current;
    el?.querySelector<HTMLElement>('button, input, select, textarea, [tabindex="0"]')?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !el) return;
      const focusable = Array.from(el.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]'));
      if (!focusable.length) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => { document.body.style.overflow = priorOverflow; document.removeEventListener('keydown', handler); previous?.focus(); };
  }, [onClose]);
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div className={`dialog ${wide ? 'dialog-wide' : ''}`} ref={ref} role="dialog" aria-modal="true" aria-labelledby="sf-dialog-title" tabIndex={-1}><div className="dialog-head"><div><h2 id="sf-dialog-title">{title}</h2>{description && <p>{description}</p>}</div><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></div>{children}</div></div>;
}
