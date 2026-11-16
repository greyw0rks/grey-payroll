import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, CheckCircle, CircleNotch, Lightning, LockKey, ShieldCheck, X } from '@phosphor-icons/react';

export function Brand({ onClick, compact = false }: { onClick: () => void; compact?: boolean }) {
  return <button className={'academy-brand' + (compact ? ' compact' : '')} onClick={onClick} aria-label="SatsAcademy home">
    <svg className="academy-mark" viewBox="0 0 44 44" aria-hidden="true">
      <rect x="1" y="1" width="42" height="42" rx="12" fill="currentColor" />
      <path d="M13 29V15h8.5c5 0 8 2.5 8 6.3S26.5 28 21.5 28H13" fill="none" stroke="#fffaf1" strokeWidth="3.5" strokeLinejoin="round" />
      <path d="M18 14v16M24 14v16" stroke="#fffaf1" strokeWidth="2" />
      <circle cx="34" cy="10" r="5" fill="#ffc082" stroke="#fffaf1" strokeWidth="2" />
    </svg>
    <span>Sats<span className="brand-weight">Academy</span><small>Learn a little. Do a lot.</small></span>
  </button>;
}

export function LoadingIcon({ size = 18 }: { size?: number }) { return <CircleNotch size={size} className="spin" aria-hidden="true" />; }
export function Pill({ children, tone = '' }: { children: ReactNode; tone?: string }) { return <span className={'pill ' + tone}>{children}</span>; }
export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{children}</p>{action}</div>;
}

export function Modal({ titleId = 'dialog-title', onClose, children, wide = false }: { titleId?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const dialog = useRef<HTMLDivElement>(null);
  // Capture the trigger before the parent commits its inert background.
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const first = dialog.current?.querySelector<HTMLElement>('[data-first-focus]') ?? dialog.current?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)');
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []).filter(node => node.getClientRects().length > 0);
      if (!nodes.length) { event.preventDefault(); dialog.current?.focus(); return; }
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes[nodes.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === nodes[nodes.length - 1]) { event.preventDefault(); nodes[0].focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
    };
  }, []);
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closeRef.current(); }}>
    <div ref={dialog} className={'dialog' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <button className="icon-button dialog-close" onClick={onClose} aria-label="Close dialog"><X size={21} /></button>
      {children}
    </div>
  </div>;
}

export function JourneyArtwork({ variant = 'hero' }: { variant?: 'hero' | 'small' }) {
  return <div className={'journey-artwork ' + variant} aria-label="An illustrated path from learning Bitcoin to checking a payment" role="img">
    <svg viewBox="0 0 560 440" aria-hidden="true">
      <defs>
        <pattern id={'art-grid-' + variant} width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="#3153d4" strokeOpacity=".09" /></pattern>
        <linearGradient id={'coin-face-' + variant} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ffe0ad" /><stop offset="1" stopColor="#ffb66d" /></linearGradient>
      </defs>
      <rect width="560" height="440" rx="28" fill={'url(#art-grid-' + variant + ')'} />
      <path d="M85 337C65 245 156 170 250 235S437 281 469 112" fill="none" stroke="#2e4dcd" strokeWidth="2" strokeDasharray="6 8" />
      <ellipse cx="290" cy="342" rx="127" ry="24" fill="#2b44aa" fillOpacity=".1" />
      <g transform="translate(172 126) rotate(-14 105 106)">
        <ellipse cx="114" cy="125" rx="92" ry="101" fill="#d77837" />
        <ellipse cx="105" cy="106" rx="92" ry="101" fill={'url(#coin-face-' + variant + ')'} stroke="#ce7537" strokeWidth="2" />
        <ellipse cx="105" cy="106" rx="75" ry="83" fill="none" stroke="#e69b56" strokeWidth="2" />
        <ellipse cx="105" cy="106" rx="66" ry="74" fill="none" stroke="#e69b56" strokeWidth="1" strokeDasharray="2 5" />
        <text x="105" y="139" textAnchor="middle" fontFamily="'Space Grotesk Variable', sans-serif" fontWeight="600" fontSize="98" fill="#975023">₿</text>
      </g>
      <g transform="translate(55 64) rotate(-8)">
        <rect x="7" y="7" width="143" height="111" rx="15" fill="#c3cbec" />
        <rect width="143" height="111" rx="15" fill="#fffdf7" stroke="#d8dded" />
        <path d="M21 23h38v40H21zM39 23v40" fill="#dfe5ff" stroke="#3153d4" strokeWidth="2" />
        <path d="M26 33h8m-8 8h8m11-8h8m-8 8h8" stroke="#3153d4" strokeWidth="2" />
        <text x="20" y="87" fill="#22336c" fontSize="12" fontFamily="'Manrope Variable', sans-serif" fontWeight="700">Start with curiosity.</text>
      </g>
      <g transform="translate(378 78) rotate(9)">
        <rect x="6" y="6" width="129" height="94" rx="14" fill="#aab8ef" />
        <rect width="129" height="94" rx="14" fill="#3153d4" />
        <path d="M60 19L42 46h16l-6 19 29-29H64l7-17z" fill="#ffc082" />
        <text x="64" y="82" textAnchor="middle" fill="#fffaf1" fontSize="12" fontFamily="'Manrope Variable', sans-serif" fontWeight="600">Try Lightning.</text>
      </g>
      <g transform="translate(61 291) rotate(-4)">
        <rect x="5" y="5" width="179" height="84" rx="14" fill="#d4dabf" />
        <rect width="179" height="84" rx="14" fill="#e4eccd" stroke="#c7d4a5" />
        <circle cx="33" cy="32" r="14" fill="#436c40" />
        <path d="M25 32l6 6 11-13" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <text x="56" y="36" fill="#2f4b2b" fontSize="12" fontFamily="'Manrope Variable', sans-serif" fontWeight="700">Check it yourself.</text>
        <text x="20" y="64" fill="#4d6548" fontSize="11" fontFamily="'Manrope Variable', sans-serif">A request is not proof.</text>
      </g>
      <circle cx="486" cy="271" r="28" fill="#fffaf1" stroke="#d9dff3" />
      <path d="M476 275l8-19 10 25z" fill="#3153d4" />
      <path d="M271 53v22m-11-11h22M437 357v18m-9-9h18" stroke="#3153d4" strokeWidth="2" />
      <circle cx="323" cy="56" r="4" fill="#ce7739" /><circle cx="463" cy="326" r="4" fill="#3153d4" />
    </svg>
    <span className="artwork-caption">Illustration · learn → practice → verify</span>
  </div>;
}

export function LessonArtwork({ id }: { id: string }) {
  if (id === 'bitcoin') return <div className="quest-art bitcoin-art" aria-hidden="true"><span className="coin-back" /><span className="coin-front">₿</span><span className="art-sat-label">100,000,000 sats</span><span className="art-orbit" /></div>;
  if (id === 'security') return <div className="quest-art security-art" aria-hidden="true"><span className="art-key"><LockKey size={71} weight="duotone" /></span><span className="art-shield"><ShieldCheck size={42} weight="fill" /></span><span className="art-secret">•••• •••• ••••</span><span className="art-orbit" /></div>;
  return <div className="quest-art lightning-art" aria-hidden="true"><span className="art-lightning"><Lightning size={84} weight="fill" /></span><span className="art-invoice"><span>10 sats</span><CheckCircle size={20} weight="fill" /></span><span className="art-orbit" /></div>;
}

export function Footer({ onGuide, onHelp }: { onGuide: () => void; onHelp: () => void }) {
  return <footer className="product-footer"><span><span className="footer-mark">s.</span>Bitcoin, within reach.</span><div><button onClick={onGuide}><BookOpen size={15} />Course guide</button><button onClick={onHelp}>About this academy<ArrowUpRight size={15} /></button><a href="https://github.com/greyw0rks/grey-payroll" target="_blank" rel="noreferrer">Open source<ArrowUpRight size={15} /></a></div></footer>;
}

export function LinkAction({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <button className="text-button" onClick={onClick}>{children}<ArrowRight size={17} /></button>; }

