export function GreyMark({ size = 34 }: { size?: number }) {
  return <svg className="grey-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#16181C" /><path d="M45 18H29C21.268 18 15 24.268 15 32s6.268 14 14 14h16V32H33" fill="none" stroke="#3DDC84" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
