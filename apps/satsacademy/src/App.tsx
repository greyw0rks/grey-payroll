import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowClockwise, ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, CaretDown, Check, CheckCircle, Copy, DownloadSimple, Flask, Globe, GraduationCap, Info, Lightning, LockKey, MagnifyingGlass, Medal, SealCheck, ShieldCheck, SignOut, Sparkle, UserCircle, Wallet, WarningCircle, X, ChatCircleDots, SquaresFour } from '@phosphor-icons/react';
import QRCode from 'qrcode';
import '@fontsource-variable/manrope';
import '@fontsource-variable/space-grotesk';
import { badges, getLesson, lessons, text, type Language, type Lesson, type LessonId } from './content';
import { api, ApiError, clearTemporaryIdentity, emptyProfile, emptyProgress, hasTemporaryIdentity, hasTemporarySigningKey, patch, post, signInTemporarily, signInWithNostr, type AcademyProfile, type AcademyProgress, type AppUser, type Exercise, type WalletState } from './api';
import { Diagram } from './Diagrams';
import { Brand, EmptyState, Footer, JourneyArtwork, LessonArtwork, LoadingIcon, Modal, Pill } from './components';
import { containsGuideSecret } from '../../../packages/academy/src/guide';
import { CONNECT_INSTALL_URL, nostrProviderStatus, watchNostrProviders } from '../../../packages/academy/src/signers';

type Page = 'landing' | 'discover' | 'lesson' | 'wallet' | 'achievements' | 'guide' | 'profile' | 'notfound';
type Route = { page: Page; lessonId?: LessonId };
type Dialog = 'account' | 'wallet' | 'onboarding' | 'help' | 'reset' | null;
type QuizResult = { score: number; total: number; passed: boolean; results: Array<{ correct: boolean; answer: number; explanation: { en: string; ha: string } }>; progress: AcademyProgress };
type GuideMessage = { id: number; role: 'user' | 'guide'; text: string; mode?: string; lessonId?: string | null };
type ExportPage = { format: string; exportedAt: number; profile: AcademyProfile; progress: { lessons: unknown[]; badges: unknown[]; completedCount: number; exercises: Array<Record<string, unknown> & { id: string }> }; attempts: unknown[]; attemptsRetention: string; pagination: { cursor: string | null; isDone: boolean } };
const base = window.location.pathname.startsWith('/academy') ? '/academy' : window.location.pathname.startsWith('/satsacademy') ? '/satsacademy' : (import.meta.env.BASE_URL.replace(/\/$/, '') || '');
const routePaths: Partial<Record<Page, string>> = { landing: '/', discover: '/app', wallet: '/app/wallet', achievements: '/app/achievements', guide: '/app/guide', profile: '/app/profile' };

function readRoute(): Route {
  const path = window.location.pathname.slice(base.length).replace(/\/$/, '') || '/';
  if (path === '/') return { page: 'landing' };
  if (path === '/app' || path === '/app/discover') return { page: 'discover' };
  for (const page of ['wallet', 'achievements', 'guide', 'profile'] as const) if (path === '/app/' + page) return { page };
  const lessonId = path.match(/^\/app\/lessons\/(bitcoin|security|lightning)$/)?.[1] as LessonId | undefined;
  return lessonId ? { page: 'lesson', lessonId } : { page: 'notfound' };
}
function initialLanguage(): Language { try { return localStorage.getItem('satsacademy-language') === 'ha' ? 'ha' : 'en'; } catch { return 'en'; } }
const shortHash = (value: string) => value.slice(0, 10) + '…' + value.slice(-8);
const displayDate = (value?: number | null) => value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const displayTime = (value: number) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Please try that action again.';

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [user, setUser] = useState<AppUser | null>(null);
  const [profile, setProfile] = useState<AcademyProfile>(emptyProfile);
  const [progress, setProgress] = useState<AcademyProgress>(emptyProgress);
  const [wallet, setWallet] = useState<WalletState>({ connected: false });
  const [walletLoading, setWalletLoading] = useState(false);
  const [temporary, setTemporary] = useState(hasTemporaryIdentity);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [lightningLabReady, setLightningLabReady] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [serviceReady, setServiceReady] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [connection, setConnection] = useState('');
  const [providers, setProviders] = useState(nostrProviderStatus);
  const [displayName, setDisplayName] = useState('');
  const [profileLanguage, setProfileLanguage] = useState<Language>('en');
  const [resetText, setResetText] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'remaining' | 'completed'>('all');
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<number[]>([-1, -1, -1]);
  const [quizResult, setQuizResult] = useState<QuizResult | null>(null);
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [qr, setQr] = useState('');
  const [verificationHint, setVerificationHint] = useState('');
  const [now, setNow] = useState(Date.now());
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<GuideMessage[]>([]);
  const accountEpoch = useRef(0);
  const routeEpoch = useRef(0);
  const routeFocus = useRef(false);
  const verificationRunning = useRef(false);
  const verificationPaused = useRef(false);
  const guideEnd = useRef<HTMLDivElement>(null);
  const messageId = useRef(0);
  const lessonFocus = useRef(false);
  const loginController = useRef<AbortController | null>(null);
  const page = route.page;
  const activeLesson = route.lessonId || 'bitcoin';
  const lesson = getLesson(activeLesson)!;
  const say = (en: string, ha: string) => language === 'ha' ? ha : en;
  const passed = (id: string) => progress.lessons.some(value => value.lessonId === id && Boolean(value.passed));
  const earned = new Set(progress.badges.map(value => value.badgeId));
  const nextLesson = lessons.find(value => !passed(value.id)) || lessons[2];
  const completed = Math.max(0, Math.min(3, progress.completedCount));
  const allComplete = completed === 3;
  const avatar = user ? (profile.displayName || 'Learner').slice(0, 2).toUpperCase() : 'YO';

  const go = useCallback((next: Page, lessonId?: LessonId) => {
    routeEpoch.current++;
    routeFocus.current = true;
    const path = next === 'lesson' ? '/app/lessons/' + (lessonId || 'bitcoin') : routePaths[next] || '/app';
    window.history.pushState({}, '', base + path);
    setRoute({ page: next, lessonId });
    setError('');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  useEffect(() => {
    const listener = () => { routeEpoch.current++; routeFocus.current = true; setRoute(readRoute()); setError(''); window.scrollTo({ top: 0, behavior: 'instant' }); };
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  }, []);
  useEffect(() => {
    if (!routeFocus.current || dialog) return;
    routeFocus.current = false;
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [route, dialog]);
  useEffect(() => {
    document.documentElement.lang = language;
    try { localStorage.setItem('satsacademy-language', language); } catch { /* Only the language preference is stored in this browser. */ }
  }, [language]);
  useEffect(() => {
    const names: Record<Page, string> = { landing: 'Learn Bitcoin by doing', discover: 'Your learning path', lesson: text(lesson.title, language), wallet: 'Wallet lab', achievements: 'Your achievements', guide: 'Course guide', profile: 'Your profile', notfound: 'Page not found' };
    document.title = names[page] + ' · SatsAcademy';
  }, [page, activeLesson, language]);
  useEffect(() => { setStep(0); setAnswers([-1, -1, -1]); setQuizResult(null); }, [activeLesson]);
  useEffect(() => {
    if (!lessonFocus.current || page !== 'lesson') return;
    lessonFocus.current = false;
    const heading = document.getElementById('lesson-section-title');
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [step, page]);
  useEffect(() => {
    const update = () => { const next = nostrProviderStatus(); setProviders(current => current.connect === next.connect && current.nip07 === next.nip07 ? current : next); };
    const unwatch = watchNostrProviders(update);
    update();
    return () => { unwatch(); loginController.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function clearLearner() {
    accountEpoch.current++;
    setUser(null); setProfile(emptyProfile); setProgress(emptyProgress); setWallet({ connected: false });
    setExercise(null); setMessages([]); setQuizResult(null); setConnection('');
    setSessionLoading(false);
    setBusy(''); setWalletLoading(false); setVerificationHint('');
    verificationPaused.current = false;
    clearTemporaryIdentity(); setTemporary(false);
  }
  function handleError(value: unknown) {
    if (value instanceof ApiError && value.status === 401) {
      clearLearner();
      setDialog('account');
      setError(say('Your session ended. Sign in again to save your next step.', 'Lokacin shiga ya ƙare. Sake shiga domin ajiye mataki na gaba.'));
    } else setError(errorMessage(value));
  }
  const loadLearner = useCallback(async (epoch: number) => {
    const results = await Promise.allSettled([
      api<AcademyProgress>('/api/academy/progress'),
      api<AcademyProfile>('/api/academy/profile'),
      api<WalletState>('/api/academy/wallet')
    ]);
    if (epoch !== accountEpoch.current) return;
    if (results[0].status === 'fulfilled') {
      const value = results[0].value;
      setProgress(value);
      setExercise(value.exercises.find(item => item.scope === 'user' && item.state === 'pending') || null);
    } else throw results[0].reason;
    if (results[1].status === 'fulfilled') {
      const value = results[1].value;
      setProfile(value); setDisplayName(value.displayName); setProfileLanguage(value.language); setLanguage(value.language);
    } else throw results[1].reason;
    if (results[2].status === 'fulfilled') setWallet(results[2].value);
    else setWallet({ connected: false, error: errorMessage(results[2].reason) });
  }, []);

  const refreshSession = useCallback(async () => {
    setSessionLoading(true); setError('');
    setWalletLoading(false);
    const epoch = ++accountEpoch.current;
    try {
      const [session, config] = await Promise.all([
        api<{ user: AppUser | null; demoEnabled: boolean }>('/api/session'),
        api<{ demoEnabled: boolean; lightningLabReady?: boolean }>('/api/config').catch(() => ({ demoEnabled: false, lightningLabReady: false }))
      ]);
      if (epoch !== accountEpoch.current) return;
      setUser(session.user); setDemoEnabled(session.demoEnabled); setServiceReady(true);
      setTemporary(hasTemporaryIdentity(session.user?.pubkey));
      setLightningLabReady(Boolean(config.demoEnabled && config.lightningLabReady));
      if (session.user) await loadLearner(epoch);
      else { setProfile(emptyProfile); setProgress(emptyProgress); setWallet({ connected: false }); setExercise(null); }
    } catch (value) {
      if (epoch === accountEpoch.current) { setServiceReady(false); setError(errorMessage(value)); }
    } finally { if (epoch === accountEpoch.current) setSessionLoading(false); }
  }, [loadLearner]);
  useEffect(() => { void refreshSession(); }, [refreshSession]);
  useEffect(() => {
    let cancelled = false;
    if (!exercise) { setQr(''); return; }
    setQr('');
    QRCode.toDataURL(exercise.bolt11, { width: 248, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#202d56', light: '#ffffff' } }).then(value => { if (!cancelled) setQr(value); }).catch(() => { if (!cancelled) setQr(''); });
    return () => { cancelled = true; };
  }, [exercise?.bolt11]);
  useEffect(() => {
    if (!exercise || exercise.state !== 'pending' || page !== 'wallet') return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [exercise?.id, exercise?.state, page]);

  async function login(kind: 'nostr' | 'temporary' | 'preview') {
    if (busy) return;
    setBusy('login-' + kind); setError('');
    const controller = new AbortController();
    loginController.current = controller;
    try {
      const session = kind === 'preview' ? await post<{ user: AppUser }>('/api/demo/session', { persona: 'learner' }) : kind === 'temporary' ? await signInTemporarily() : await signInWithNostr(controller.signal);
      if (controller.signal.aborted) return;
      const epoch = ++accountEpoch.current;
      setSessionLoading(false);
      setWalletLoading(false);
      setUser(session.user); setProfile(emptyProfile); setProgress(emptyProgress); setWallet({ connected: false }); setExercise(null);
      setMessages([]); setQuizResult(null); setVerificationHint(''); setDisplayName(''); setConnection('');
      setTemporary(hasTemporaryIdentity()); setServiceReady(true);
      await loadLearner(epoch);
      if (epoch !== accountEpoch.current) return;
      const saved = await api<AcademyProfile>('/api/academy/profile');
      if (epoch !== accountEpoch.current) return;
      setProfile(saved); setDisplayName(saved.displayName); setProfileLanguage(saved.language);
      setDialog(saved.onboardingComplete ? null : 'onboarding');
      if (page === 'landing') go('discover');
      setToast(say('Your learning space is ready.', 'Wurin koyonka ya shirya.'));
    } catch (value) { if (!controller.signal.aborted) handleError(value); }
    finally { if (loginController.current === controller) { loginController.current = null; setBusy(''); } }
  }
  async function logout() {
    if (busy) return;
    setBusy('logout'); setError('');
    try {
      await post('/api/session/logout');
      clearLearner(); setDialog(null); setToast(say('Signed out. Your saved learning stays with your identity.', 'An fita. An ajiye koyonka da shaidarka.'));
      go('discover');
    } catch (value) { handleError(value); }
    finally { setBusy(''); }
  }
  function openAccount() {
    setError('');
    if (user) go('profile'); else setDialog('account');
  }
  function openWallet() {
    setError(''); setConnection('');
    if (!user) setDialog('account'); else setDialog('wallet');
  }
  function closeDialog() {
    loginController.current?.abort();
    setDialog(null); setConnection(''); setResetText(''); setError('');
  }
  function goStep(next: number) {
    if (next === step) return;
    lessonFocus.current = true;
    setStep(next);
    setError('');
  }
  async function saveProfile(event: FormEvent, onboarding = false) {
    event.preventDefault();
    if (busy) return;
    if (!displayName.trim()) { setError(say('Tell us what to call you.', 'Faɗa sunan da za mu kira ka.')); return; }
    setBusy('profile'); setError('');
    const epoch = accountEpoch.current;
    try {
      const value = await patch<AcademyProfile>('/api/academy/profile', { displayName: displayName.trim(), language: profileLanguage, ...(onboarding ? { onboardingComplete: true } : {}) });
      if (epoch !== accountEpoch.current) return;
      setProfile(value); setLanguage(value.language); setDisplayName(value.displayName);
      if (onboarding) { setDialog(null); go('discover'); }
      setToast(say('Learning preferences saved.', 'An ajiye saitunan koyo.'));
    } catch (value) { if (epoch === accountEpoch.current) handleError(value); }
    finally { if (epoch === accountEpoch.current) setBusy(''); }
  }
  async function setPreferredLanguage(value: Language) {
    if (busy || sessionLoading) return;
    setLanguage(value); setProfileLanguage(value);
    if (!user) return;
    setBusy('language');
    const epoch = accountEpoch.current;
    try {
      const saved = await patch<AcademyProfile>('/api/academy/profile', { language: value });
      if (epoch === accountEpoch.current) setProfile(saved);
    } catch (cause) { if (epoch === accountEpoch.current) handleError(cause); }
    finally { if (epoch === accountEpoch.current) setBusy(''); }
  }
  async function submitQuiz(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (answers.some(value => value < 0)) { setError(say('Choose an answer for all three questions.', 'Zaɓi amsar duk tambayoyi uku.')); return; }
    if (!user) { setDialog('account'); return; }
    setBusy('quiz'); setError('');
    const epoch = accountEpoch.current;
    const lessonRoute = routeEpoch.current;
    const lessonId = activeLesson;
    try {
      const value = await post<QuizResult>('/api/academy/lessons/' + lessonId + '/quiz', { answers });
      if (epoch !== accountEpoch.current) return;
      if (lessonRoute === routeEpoch.current) setQuizResult(value);
      setProgress(value.progress);
      if (value.passed) setToast(say('Lesson complete. Your achievement is earned.', 'An gama darasi. Ka samu lambar nasara.'));
    } catch (value) { if (epoch === accountEpoch.current && lessonRoute === routeEpoch.current) handleError(value); }
    finally { if (epoch === accountEpoch.current) setBusy(''); }
  }
  async function connectWallet(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const uri = connection.trim();
    setConnection(''); setBusy('wallet-connect'); setError('');
    const epoch = accountEpoch.current;
    try {
      await post('/api/academy/wallet/connect', { connectionUri: uri });
      const value = await api<WalletState>('/api/academy/wallet');
      if (epoch !== accountEpoch.current) return;
      setWallet(value); setDialog(null);
      setToast(say('Wallet connected. Ready to receive and verify.', 'An haɗa walat. An shirya karɓa da tabbatarwa.'));
    } catch (value) { if (epoch === accountEpoch.current) handleError(value); }
    finally { if (epoch === accountEpoch.current) setBusy(''); }
  }
  async function connectLocalWallet() {
    if (busy || !demoEnabled || !lightningLabReady) return;
    setBusy('wallet-local'); setError('');
    const epoch = accountEpoch.current;
    try {
      const value = await post<WalletState>('/api/academy/demo/wallet', { wallet: 'alice' });
      if (epoch !== accountEpoch.current) return;
      setWallet(value); setDialog(null);
      setToast(say('Local regtest wallet connected. These coins have no monetary value.', 'An haɗa walat na regtest. Waɗannan kuɗaɗe ba su da ƙimar kuɗi.'));
    } catch (value) { if (epoch === accountEpoch.current) handleError(value); }
    finally { if (epoch === accountEpoch.current) setBusy(''); }
  }
  async function refreshWallet() {
    if (walletLoading || !user) return;
    setWalletLoading(true); setError('');
    const epoch = accountEpoch.current;
    try { const value = await api<WalletState>('/api/academy/wallet'); if (epoch === accountEpoch.current) setWallet(value); }
    catch (value) { if (epoch === accountEpoch.current) handleError(value); }
    finally { if (epoch === accountEpoch.current) setWalletLoading(false); }
  }
  async function disconnectWallet() {
    if (busy) return;
    setBusy('wallet-disconnect'); setError('');
    const epoch = accountEpoch.current;
    try {
      await api('/api/academy/wallet', { method: 'DELETE', body: '{}' });
      if (epoch !== accountEpoch.current) return;
      setWallet({ connected: false }); setDialog(null);
      setToast(say('Wallet disconnected. Revoke the connection in your wallet provider too.', 'An cire haɗin walat. Cire izinin haɗin a wajen mai ba da walat ma.'));
    } catch (value) { if (epoch === accountEpoch.current) handleError(value); }
    finally { if (epoch === accountEpoch.current) setBusy(''); }
  }
  async function createExercise() {
    if (busy) return;
    if (!user) { setDialog('account'); return; }
    if (!wallet.connected) { openWallet(); return; }
    setBusy('exercise-create'); setError('');
    const epoch = accountEpoch.current;
    try {
      const value = await post<Exercise>('/api/academy/exercises', { mode: 'receive' });
      const state = await api<AcademyProgress>('/api/academy/progress');
      if (epoch !== accountEpoch.current) return;
      setExercise(value); setProgress(state); setNow(Date.now()); setVerificationHint('');
      setToast(say('Invoice created. It is waiting for a payment.', 'An ƙirƙiri invoice. Ana jiran biya.'));
    } catch (value) { if (epoch === accountEpoch.current) handleError(value); }
    finally { if (epoch === accountEpoch.current) setBusy(''); }
  }
  async function verifyExercise(silent = false) {
    if (!exercise || verificationRunning.current || verificationPaused.current || (!silent && busy)) return;
    verificationRunning.current = true;
    if (!silent) { setBusy('exercise-verify'); setError(''); }
    setVerificationHint('');
    const epoch = accountEpoch.current;
    const id = exercise.id;
    try {
      const value = await post<{ verified: boolean; state: Exercise['state']; settledAt?: number; progress: AcademyProgress }>('/api/academy/exercises/' + id + '/verify');
      if (epoch !== accountEpoch.current) return;
      setExercise(current => current?.id === id ? { ...current, state: value.state, settledAt: value.settledAt } : current);
      setProgress(value.progress);
      if (value.verified) {
        if (exercise.state !== 'settled') setToast(say('Payment verified. Lightning Explorer earned.', 'An tabbatar da biya. An samu Lightning Explorer.'));
      } else if (!silent) setToast(value.state === 'expired' ? say('The invoice expired. Create a fresh one.', 'Invoice ya ƙare. Ƙirƙiri sabo.') : say('Still pending. The receiving wallet has not confirmed a payment.', 'Ana jiran biya. Walat na karɓa bai tabbatar da kuɗi ba.'));
    } catch (value) {
      if (epoch === accountEpoch.current) {
        if (!silent || value instanceof ApiError && value.status === 401) handleError(value);
        else setVerificationHint(errorMessage(value));
      }
    }
    finally { verificationRunning.current = false; if (!silent && epoch === accountEpoch.current) setBusy(''); }
  }
  useEffect(() => {
    if (!user || !exercise || exercise.state !== 'pending' || page !== 'wallet') return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void verifyExercise(true); }, 10000);
    return () => window.clearInterval(timer);
  }, [user?.pubkey, exercise?.id, exercise?.state, page]);

  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setToast(label + say(' copied.', ' an kwafa.')); }
    catch { setError(say('Your browser could not copy this. Select the full text and copy it manually.', 'Browser bai iya kwafa ba. Zaɓi rubutun gaba ɗaya kuma ka kwafa da kanka.')); }
  }
  async function askGuide(value = question) {
    if (busy || value.trim().length < 3) return;
    const trimmed = value.trim();
    if (containsGuideSecret(trimmed)) {
      setQuestion('');
      setError(say('That looks like a wallet credential or private key. It was not sent to the guide. Ask a question without secrets.', 'Wannan yana kama da sirrin walat ko maballin sirri. Ba a aika wa jagora ba. Yi tambaya ba tare da sirri ba.'));
      return;
    }
    setBusy('guide'); setQuestion(''); setError('');
    const epoch = accountEpoch.current;
    const id = ++messageId.current;
    setMessages(current => [...current, { id, role: 'user', text: trimmed }]);
    try {
      const result = await post<{ answer: string; mode: string; lessonId: string | null }>('/api/academy/guide', { question: trimmed, language });
      if (epoch !== accountEpoch.current) return;
      setMessages(current => [...current, { id: ++messageId.current, role: 'guide', text: result.answer, mode: result.mode, lessonId: result.lessonId }]);
    } catch (value) { if (epoch === accountEpoch.current) handleError(value); }
    finally { if (epoch === accountEpoch.current) setBusy(''); }
  }
  useEffect(() => {
    if (page === 'guide' && messages.length) guideEnd.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
  }, [messages, page]);
  async function exportLearning() {
    if (busy) return;
    setBusy('export'); setError('');
    const epoch = accountEpoch.current;
    try {
      const first = await api<ExportPage>('/api/academy/export');
      if (epoch !== accountEpoch.current) return;
      const receipts = new Map(first.progress.exercises.map(item => [item.id, item]));
      const seenCursors = new Set<string>();
      let pageValue = first;
      let pageCount = 1;
      while (!pageValue.pagination.isDone) {
        const cursor = pageValue.pagination.cursor;
        if (!cursor || seenCursors.has(cursor) || pageCount >= 100) throw new Error(say('The full learning record could not be downloaded. No partial export was created; please try again.', 'Ba a sauke cikakken bayani ba. Ba a ƙirƙiri fayil marar cikawa ba; sake gwadawa.'));
        seenCursors.add(cursor);
        pageValue = await api<ExportPage>('/api/academy/export?cursor=' + encodeURIComponent(cursor));
        if (epoch !== accountEpoch.current) return;
        for (const item of pageValue.progress.exercises) receipts.set(item.id, item);
        pageCount++;
      }
      const value = { ...first, progress: { ...first.progress, exercises: Array.from(receipts.values()) }, pagination: { cursor: null, isDone: true }, receiptsExported: receipts.size, exportPages: pageCount };
      const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'satsacademy-learning-' + new Date().toISOString().slice(0, 10) + '.json'; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setToast(say('Your learning record downloaded.', 'An sauke bayanan koyonka.'));
    } catch (value) { if (epoch === accountEpoch.current) handleError(value); }
    finally { if (epoch === accountEpoch.current) setBusy(''); }
  }
  async function resetLessons(event: FormEvent) {
    event.preventDefault();
    if (busy || resetText !== 'RESET') return;
    setBusy('reset'); setError('');
    const epoch = ++accountEpoch.current;
    verificationPaused.current = true;
    setWalletLoading(false);
    try {
      const result = await api<{ ok: boolean; progress: AcademyProgress }>('/api/academy/progress', { method: 'DELETE', body: JSON.stringify({ confirmation: resetText }) });
      if (epoch !== accountEpoch.current) return;
      setProgress(result.progress); setQuizResult(null); setDialog(null); setResetText('');
      setToast(say('Lessons reset. Verified payment evidence is retained.', 'An sake saita darussa. An riƙe hujjar biya.'));
    } catch (value) { if (epoch === accountEpoch.current) handleError(value); }
    finally { verificationPaused.current = false; if (epoch === accountEpoch.current) setBusy(''); }
  }

  const nav = [
    { page: 'discover' as const, label: say('Discover', 'Darussa'), mobile: say('Learn', 'Darussa'), icon: SquaresFour },
    { page: 'wallet' as const, label: say('Wallet lab', 'Gwajin walat'), mobile: say('Wallet lab', 'Walat'), icon: Flask },
    { page: 'achievements' as const, label: say('Achievements', 'Nasarori'), mobile: say('Badges', 'Nasarori'), icon: Medal },
    { page: 'guide' as const, label: say('Course guide', 'Jagoran darasi'), mobile: say('Guide', 'Jagora'), icon: ChatCircleDots }
  ];
  const matches = lessons.filter(item => {
    const match = (text(item.title, language) + ' ' + text(item.skill, language)).toLowerCase().includes(search.trim().toLowerCase());
    return match && (filter === 'all' || filter === 'completed' && passed(item.id) || filter === 'remaining' && !passed(item.id));
  });
  const invoiceExpired = exercise?.state === 'expired' || Boolean(exercise?.state === 'pending' && exercise.expiresAt <= now);
  const missingCapability = wallet.connected && ['make_invoice', 'lookup_invoice'].some(method => !(wallet.capabilities || []).includes(method));
  const statusLabel = exercise?.state === 'settled' ? say('Verified payment', 'Tabbataccen biya') : invoiceExpired ? say('Invoice expired', 'Invoice ya ƙare') : say('Waiting for payment', 'Ana jiran biya');

  function lessonCard(item: Lesson, landing = false) {
    const finished = passed(item.id);
    return <button key={item.id} className={'quest-card quest-' + item.color + (finished && !landing ? ' is-complete' : '')} onClick={() => go('lesson', item.id)}>
      <div className="quest-cover"><div className="quest-cover-top"><Pill tone="paper">{say('QUEST', 'DARASI')} {item.number}</Pill><span>{item.minutes} {say('min', 'minti')}</span></div><LessonArtwork id={item.id} /><span className="cover-caption">{item.id === 'bitcoin' ? say('Small units. Big understanding.', 'Ƙananan kaso. Babbar fahimta.') : item.id === 'security' ? say('Your wallet. Your boundaries.', 'Walat ɗinka. Iyakokinka.') : say('A request. A payment. A proof.', 'Neman biya. Kuɗi. Hujja.')}</span></div>
      <div className="quest-body"><span className="quest-category">{item.id === 'bitcoin' ? say('BITCOIN BASICS', 'TUSHEN BITCOIN') : item.id === 'security' ? say('WALLET SAFETY', 'TSARON WALAT') : say('LIGHTNING PAYMENTS', 'BIYAN LIGHTNING')}</span><h3>{text(item.title, language)}</h3><p>{text(item.subtitle, language)}</p><div className="quest-card-bottom"><span>{finished && !landing ? <><CheckCircle size={17} weight="fill" />{say('Complete · revisit', 'An gama · sake duba')}</> : <><BookOpen size={17} />{say('Start this quest', 'Fara wannan darasi')}</>}</span><span className="card-arrow"><ArrowUpRight size={22} /></span></div></div>
    </button>;
  }
  const ErrorNotice = () => error ? <div className="error-notice" role="alert"><WarningCircle size={21} /><div><strong>{say('Let’s get you back on track.', 'Mu taimaka maka ci gaba.')}</strong><p>{error}</p></div>{!serviceReady && <button className="text-button" disabled={sessionLoading} onClick={() => void refreshSession()}>{sessionLoading ? <LoadingIcon /> : <ArrowClockwise size={18} />}{say('Retry', 'Sake gwadawa')}</button>}<button className="icon-button" onClick={() => setError('')} aria-label={say('Dismiss error', 'Rufe kuskure')}><X size={17} /></button></div> : null;

  return <div className="academy-root">
    <div className="page-shell" inert={Boolean(dialog)}>
      <a className="skip-link" href="#main-content">{say('Skip to learning content', 'Tsallake zuwa darasi')}</a>
      {page === 'landing' ? <>
        <header className="landing-header container"><Brand onClick={() => go('landing')} /><nav aria-label={say('Academy links', 'Hanyoyin academy')}><a href="#learning-path">{say('The learning path', 'Hanyar koyo')}</a><button onClick={() => { setError(''); setDialog('help'); }}>{say('How it works', 'Yadda yake aiki')}</button></nav><div className="header-actions"><button className="language-switch" onClick={() => void setPreferredLanguage(language === 'en' ? 'ha' : 'en')} aria-label={say('Switch to Hausa', 'Canja zuwa English')}><Globe size={18} />{language.toUpperCase()}</button><button className="button dark small" onClick={() => user ? go('discover') : setDialog('account')}>{user ? say('My learning', 'Koyona') : say('Sign in', 'Shiga')}<ArrowUpRight size={16} /></button></div></header>
        <main id="main-content" tabIndex={-1} className="landing-main container">
          <ErrorNotice />
          <section className="landing-hero"><div className="landing-hero-copy"><Pill tone="outline"><span className="tiny-dot" />{say('YOUR FIRST BITCOIN SKILLS', 'ƘWAREWARKA TA BITCOIN')}</Pill><h1>{say('From curious', 'Daga son sani')}<br />{say('to ', 'zuwa ')}<span className="headline-highlight">{say('confident.', 'fahimta.')}</span></h1><p>{say('Bitcoin makes more sense when you use it. Learn the essentials, build safe wallet habits, and check your first Lightning payment yourself.', 'Bitcoin ya fi sauƙin fahimta idan ka yi amfani da shi. Koyi tushensa, kiyaye walat, kuma tabbatar da biyanka na farko ta Lightning da kanka.')}</p><div className="hero-actions"><button className="button primary" onClick={() => go('discover')}>{say('Start learning', 'Fara koyo')}<ArrowRight size={20} /></button><a className="button plain" href="#learning-path">{say('Explore the path', 'Duba hanyar koyo')}<ArrowDown size={19} /></a></div><div className="hero-facts"><span>{say('Free to learn', 'Koyo kyauta')}</span><i /><span>{say('English & Hausa', 'English da Hausa')}</span><i /><span>{say('At your pace', 'A lokacinka')}</span></div></div><JourneyArtwork /></section>
          <div className="landing-promise-strip"><div><span>01</span><strong>{say('Understand the money.', 'Fahimci kuɗin.')}</strong><p>{say('Sats, networks, and payment basics.', 'Sats, hanyoyi da tushen biya.')}</p></div><div><span>02</span><strong>{say('Keep wallet control.', 'Kiyaye ikon walat.')}</strong><p>{say('Keys stay private. Permissions stay small.', 'Maballai a sirri. Izini kaɗan.')}</p></div><div><span>03</span><strong>{say('Check it yourself.', 'Tabbatar da kanka.')}</strong><p>{say('A payment you can actually verify.', 'Biya da za ka iya tabbatarwa.')}</p></div></div>
          <section id="learning-path" className="landing-path"><div className="section-heading"><div><h2>{say('Your first three quests.', 'Darussanka uku na farko.')}</h2></div><span className="section-note">{say('About 21 minutes, then a hands-on exercise.', 'Kusan minti 21, sannan gwaji a aikace.')}</span></div><div className="quest-grid">{lessons.map(item => lessonCard(item, true))}</div></section>
          <section className="landing-lab-block"><div><Pill tone="cobalt-light"><Flask size={16} />{say('THE WALLET LAB', 'GWAJIN WALAT')}</Pill><h2>{say('A badge that comes', 'Lamba da ke zuwa')}<br />{say('after the proof.', 'bayan hujja.')}</h2><p>{say('A quiz checks what you know. The wallet lab checks what you can do. Create a 10-sat invoice and earn Lightning Explorer only after your receiving wallet verifies the matching payment.', 'Tambayoyi suna duba iliminka. Gwajin walat yana duba aikinka. Ƙirƙiri invoice na sats 10, kuma samu Lightning Explorer bayan walat na karɓa ya tabbatar da biya.')}</p><button className="button light" onClick={() => go('wallet')}>{say('Explore the wallet lab', 'Duba gwajin walat')}<ArrowUpRight size={18} /></button></div><div className="proof-steps"><div><span>01</span><Wallet size={24} /><strong>{say('Connect your wallet', 'Haɗa walat ɗinka')}</strong><p>{say('Invoice creation and lookup permissions.', 'Izinin ƙirƙira da duba invoice.')}</p></div><div><span>02</span><Lightning size={24} /><strong>{say('Receive 10 sats', 'Karɓi sats 10')}</strong><p>{say('Use a second wallet on the same network.', 'Yi amfani da walat na biyu a hanya ɗaya.')}</p></div><div><span>03</span><SealCheck size={24} /><strong>{say('Verify the payment', 'Tabbatar da biya')}</strong><p>{say('Matching hash. Matching amount. Settled.', 'Hash da adadi sun dace. An biya.')}</p></div></div></section>
          <section className="landing-faq"><div><h2>{say('Before you begin.', 'Kafin ka fara.')}</h2><p>{say('You do not need to know the jargon. You just need a little curiosity.', 'Ba sai ka san kalmomi masu wahala ba. Son sani kaɗan ya isa.')}</p></div><div className="faq-list">
            <details><summary>{say('Do I need to buy Bitcoin to learn?', 'Sai na sayi Bitcoin kafin koyo?')}<span>+</span></summary><p>{say('No. All lessons are free to read. Wallet practice uses a 10-sat invoice and needs two wallets on the same network. A local regtest setup uses coins with no monetary value; external wallets may use real sats.', 'A’a. Karanta darussa kyauta ne. Gwajin walat yana amfani da invoice na sats 10 da walat biyu a hanya ɗaya. Regtest na gida yana amfani da kuɗaɗe marasa ƙima; walat na waje na iya amfani da sats na gaske.')}</p></details>
            <details><summary>{say('Why do I sign in with Nostr?', 'Me ya sa ake shiga da Nostr?')}<span>+</span></summary><p>{say('A signed Nostr identity saves your progress without a password. Use an existing signer for an identity you can keep. A temporary identity lets you try the app, but its signing key stays only in this tab’s memory and cannot be recovered after it is lost.', 'Shaidar Nostr da aka sa hannu tana ajiye ci gabanka ba tare da kalmar sirri ba. Yi amfani da signer domin shaidar da za ka riƙe. Shaida ta wucin gadi tana barin ka gwada manhaja, amma maballinta yana cikin ƙwaƙwalwar wannan tab kawai.')}</p></details>
            <details><summary>{say('Does the academy control my wallet?', 'Academy yana sarrafa walat ɗina?')}<span>+</span></summary><p>{say('Your wallet stays with your provider. An NWC connection grants selected permissions. This receiving exercise needs only make_invoice and lookup_invoice; balance access is optional. The academy stores the delegated connection encrypted on the server. Revoke it with your provider when you are finished.', 'Walat yana wajen mai ba da walat. Haɗin NWC yana ba da izini kaɗan. Gwajin karɓa yana buƙatar make_invoice da lookup_invoice; duba ma’auni zaɓi ne. Ana ɓoye haɗin a kan server. Cire izini a wajen mai ba da walat idan ka gama.')}</p></details>
            <details><summary>{say('Can I learn in Hausa?', 'Zan iya koyo da Hausa?')}<span>+</span></summary><p>{say('Yes. Switch the language at the top of the page. Lessons and knowledge checks are available in English and Hausa. Hausa translations are a first draft awaiting native-speaker review.', 'I, zaɓi harshenka a saman shafi. Darussa da tambayoyi suna cikin English da Hausa. Fassarar Hausa daftarin farko ne da ake jiran bitar masu harshen.')}</p></details>
          </div></section>
          <section className="final-cta"><span className="final-cta-icon"><Sparkle size={36} weight="fill" /></span><div><h2>{say('Start small. Leave with a skill.', 'Fara da kaɗan. Samu ƙwarewa.')}</h2><p>{say('Your first quest is six minutes away.', 'Darasinka na farko yana ɗaukar minti shida.')}</p></div><button className="button dark" onClick={() => go('lesson', 'bitcoin')}>{say('Try the first lesson', 'Gwada darasi na farko')}<ArrowRight size={18} /></button></section>
        </main>
        <div className="container"><Footer onGuide={() => go('guide')} onHelp={() => setDialog('help')} /></div>
      </> : <>
        <header className="app-header"><div className="container app-header-inner"><Brand compact onClick={() => go('landing')} /><nav className="desktop-nav" aria-label={say('Learning navigation', 'Hanyoyin koyo')}>{nav.map(item => <button key={item.page} onClick={() => go(item.page)} aria-current={page === item.page || page === 'lesson' && item.page === 'discover' ? 'page' : undefined} className={page === item.page || page === 'lesson' && item.page === 'discover' ? 'active' : ''}>{item.label}</button>)}</nav><div className="header-actions"><button className="language-switch" onClick={() => void setPreferredLanguage(language === 'en' ? 'ha' : 'en')} aria-label={say('Switch to Hausa', 'Canja zuwa English')} disabled={Boolean(busy)}><Globe size={18} />{language.toUpperCase()}<CaretDown size={12} /></button><button className={'account-button ' + (user ? 'signed-in' : '')} onClick={openAccount} disabled={sessionLoading} aria-label={user ? say('Your profile', 'Bayananka') : say('Sign in to save your progress', 'Shiga domin ajiye ci gaba')}>{sessionLoading ? <LoadingIcon /> : user ? <><span className="avatar">{avatar}</span><span className="account-name">{profile.displayName}</span></> : <><UserCircle size={20} /><span>{say('Sign in', 'Shiga')}</span></>}</button></div></div></header>
        <div className="workspace-status container"><span><span className={'tiny-dot ' + (!serviceReady ? 'amber' : '')} />{sessionLoading ? say('Opening your learning space…', 'Ana buɗe wurin koyonka…') : !serviceReady ? say('Lessons available · service unavailable', 'Darussa suna nan · sabis bai samu ba') : user?.demo ? say('Local regtest learning preview', 'Gwajin koyo na regtest') : user ? say('Progress saved to your Nostr identity', 'Ana ajiye ci gaba da shaidar Nostr') : say('Explore freely · sign in to save progress', 'Karanta kyauta · shiga domin ajiya')}</span><span className="status-progress"><BookOpen size={15} />{completed}/3 {say('quests complete', 'darussa sun cika')}</span></div>
        <main id="main-content" tabIndex={-1} className="app-main container">
          <ErrorNotice />
          {temporary && user && <div className="identity-notice"><ShieldCheck size={19} /><p><strong>{say('Temporary identity.', 'Shaida ta wucin gadi.')}</strong> {hasTemporarySigningKey() ? say('Your signing key exists only in this tab’s memory. Use Connect or another Nostr signer for progress you can return to.', 'Maballinka yana cikin ƙwaƙwalwar wannan tab kawai. Yi amfani da Connect ko wani signer domin dawo da ci gabanka.') : say('Reloading lost your temporary signing key. This session can still save progress, but it cannot be restored after sign-out or expiry. Use Connect or another Nostr signer for ongoing learning.', 'Sake buɗe shafi ya rasa maballin wucin gadi. Ana iya ajiye ci gaba yanzu, amma ba za a dawo da lokacin shiga bayan fita ko ƙarewa ba. Yi amfani da Connect ko wani signer domin ci gaba.')}</p><button onClick={() => setDialog('account')}>{say('About sign-in', 'Game da shiga')}<ArrowUpRight size={16} /></button></div>}

          {page === 'discover' && <>
            <div className="page-heading"><div><h1>{user ? say('Good to see you, ', 'Maraba, ') + profile.displayName + '.' : say('A little curious?', 'Kana son sani?')}<br className="mobile-only" /> {!user && <span>{say('Start here.', 'Fara nan.')}</span>}</h1><p>{say('Learn one useful thing. Try it. Make it yours.', 'Koyi abu ɗaya mai amfani. Gwada shi. Fahimce shi.')}</p></div><Pill tone="outline"><GraduationCap size={18} />{say('BEGINNER PATH', 'HANYAR MASU FARAWA')}</Pill></div>
            <section className="discover-hero"><div><Pill tone="paper"><Sparkle size={15} weight="fill" />{allComplete ? say('FOUNDATIONS COMPLETE', 'AN GAMA TUSHE') : say('YOUR NEXT SMALL STEP', 'MATAKINKA NA GABA')}</Pill><h2>{allComplete ? say('You know the basics.', 'Ka fahimci tushen.') : say('Small lessons.', 'Ƙananan darussa.')}<br /><span>{allComplete ? say('Now make them real.', 'Yanzu yi a aikace.') : say('Real Bitcoin skills.', 'Ƙwarewar Bitcoin.')}</span></h2><p>{say('Make sense of sats, keep your wallet safe, and verify a Lightning payment with your own wallet.', 'Fahimci sats, kiyaye walat, kuma tabbatar da biyanka ta Lightning da walat ɗinka.')}</p><button className="button dark" onClick={() => allComplete ? go('wallet') : go('lesson', nextLesson.id)}>{allComplete ? say('Open the wallet lab', 'Buɗe gwajin walat') : completed ? say('Continue learning', 'Ci gaba da koyo') : say('Begin your first quest', 'Fara darasinka na farko')}<ArrowRight size={19} /></button></div><JourneyArtwork variant="small" /></section>
            <section className="learning-progress"><div className="progress-summary"><span className="progress-icon"><BookOpen size={24} weight="duotone" /></span><div><strong>{completed === 0 ? say('A fresh start looks good on you.', 'Sabon fara yana da kyau.') : allComplete ? say('Three quests. A stronger foundation.', 'Darussa uku. Tushe mai ƙarfi.') : say('Your confidence is taking shape.', 'Fahimtarka tana ƙaruwa.')}</strong><p>{completed}/3 {say('lessons completed', 'darussa sun cika')} <span>·</span> {progress.badges.length}/4 {say('achievements earned', 'lambobi an samu')}</p></div></div><div className="segmented-progress" aria-label={say('Lesson progress: ', 'Ci gaban darasi: ') + completed + '/3'}>{lessons.map(item => <button key={item.id} className={passed(item.id) ? 'complete' : ''} onClick={() => go('lesson', item.id)} aria-label={text(item.title, language) + (passed(item.id) ? say(' complete', ' an gama') : '')}><span /><small>{item.number}{passed(item.id) && <Check size={13} />}</small></button>)}</div></section>
            <div className="section-heading"><div><h2>{say('The essentials, without the overwhelm.', 'Muhimman abubuwa a sauƙaƙe.')}</h2></div><span className="section-note">{say('3 quests · about 21 minutes', 'Darussa 3 · kusan minti 21')}</span></div>
            <div className="discovery-controls"><div className="filter-list" aria-label={say('Filter lessons', 'Tace darussa')}>{(['all', 'remaining', 'completed'] as const).map(value => <button key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? say('All quests', 'Duk darussa') : value === 'remaining' ? say('To explore', 'Ba a gama ba') : say('Completed', 'An gama')}{value === 'completed' && <span>{completed}</span>}</button>)}</div><label className="search-field"><MagnifyingGlass size={19} /><span className="sr-only">{say('Search lessons', 'Nemo darussa')}</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder={say('Find a skill…', 'Nemo ƙwarewa…')} maxLength={100} />{search && <button className="icon-button" onClick={() => setSearch('')} aria-label={say('Clear search', 'Share nema')}><X size={17} /></button>}</label></div>
            {matches.length ? <div className="quest-grid">{matches.map(item => lessonCard(item))}</div> : <EmptyState icon={<MagnifyingGlass size={34} />} title={say('No quests here just yet.', 'Babu darussa a nan yanzu.')} action={<button className="button secondary" onClick={() => { setSearch(''); setFilter('all'); }}>{say('Show all quests', 'Nuna duk darussa')}<ArrowRight size={17} /></button>}>{search ? say('Try a different search, or explore the full path.', 'Gwada wani nema, ko duba duk hanyar.') : say('Finish a lesson to find it in your completed collection.', 'Gama darasi domin ya bayyana a cikin waɗanda ka gama.')}</EmptyState>}
            <div className="discover-extras"><section className="lab-teaser"><span className="teaser-icon"><Flask size={37} weight="duotone" /></span><div><h3>{say('Know it. Then do it.', 'Fahimci. Sannan yi.')}</h3><p>{say('A 10-sat invoice. Your receiving wallet. A payment you can check.', 'Invoice na sats 10. Walat na karɓa. Biya da za ka tabbatar.')}</p></div><button className="button light" onClick={() => go('wallet')}>{say('Try the wallet lab', 'Gwada walat')}<ArrowUpRight size={18} /></button></section><section className="guide-teaser"><span className="teaser-icon"><ChatCircleDots size={34} weight="duotone" /></span><h3>{say('Questions are part of it.', 'Tambayoyi suna da amfani.')}</h3><p>{say('Get a clear explanation from your course guide.', 'Samu bayani mai sauƙi daga jagoran darasi.')}</p><button className="text-button" onClick={() => go('guide')}>{say('Ask your question', 'Yi tambayarka')}<ArrowRight size={17} /></button></section></div>
          </>}

          {page === 'lesson' && <>
            <button className="back-link" onClick={() => go('discover')}><ArrowLeft size={18} />{say('Back to your quests', 'Komawa darussanka')}</button>
            <div className="page-heading lesson-heading"><div><span className="eyebrow">{say('QUEST', 'DARASI')} {lesson.number} <span> / </span>{text(lesson.skill, language)}</span><h1>{text(lesson.title, language)}</h1><p>{text(lesson.subtitle, language)}</p></div><Pill tone={passed(lesson.id) ? 'sage' : 'outline'}>{passed(lesson.id) ? <CheckCircle size={16} weight="fill" /> : <BookOpen size={16} />}{passed(lesson.id) ? say('Complete · revisit anytime', 'An gama · sake duba') : lesson.minutes + ' ' + say('minutes · at your pace', 'minti · a lokacinka')}</Pill></div>
            <nav className="lesson-stepper" aria-label={say('Lesson steps', 'Matakan darasi')}>{[0, 1, 2, 3].map(value => <button key={value} className={step === value ? 'active' : step > value ? 'visited' : ''} aria-current={step === value ? 'step' : undefined} onClick={() => goStep(value)}><span>{step > value ? <Check size={15} /> : value + 1}</span><strong>{value === 3 ? say('Knowledge check', 'Tambayoyi') : text(lesson.sections[value].title, language)}</strong><small>{value === 3 ? say('3 questions', 'Tambayoyi 3') : say('Read & explore', 'Karanta & gwada')}</small></button>)}</nav>
            <div className="lesson-layout"><article className="lesson-reader">
              {step < 3 ? <><span className="reader-overline">{say('STEP', 'MATAKI')} 0{step + 1} / 03</span><h2 id="lesson-section-title" tabIndex={-1}>{text(lesson.sections[step].title, language)}</h2>{lesson.sections[step].body.map((body, index) => <p key={index}>{text(body, language)}</p>)}<Diagram kind={lesson.sections[step].diagram} language={language} /><div className="takeaway"><span><Sparkle size={20} weight="fill" /></span><div><strong>{say('Take this with you', 'Ka riƙe wannan')}</strong><p>{text(lesson.sections[step].takeaway, language)}</p></div></div><div className="reader-controls"><button className="button secondary" onClick={() => step > 0 ? goStep(step - 1) : go('discover')}><ArrowLeft size={18} />{say('Back', 'Baya')}</button><span>{step + 1}/3</span><button className="button primary" onClick={() => goStep(step + 1)}>{step === 2 ? say('Check what you know', 'Gwada iliminka') : say('Next step', 'Mataki na gaba')}<ArrowRight size={18} /></button></div></> : <>
                <span className="reader-overline">{say('A SMALL CHECK, A STRONGER FOUNDATION', 'ƘARAMIN GWAJI, TUSHE MAI ƘARFI')}</span><h2 id="lesson-section-title" tabIndex={-1}>{say('Make sure it makes sense.', 'Tabbatar ka fahimta.')}</h2><p>{say('Three questions to check the essentials. All three need to be right; you can try again as often as you need.', 'Tambayoyi uku domin duba tushen. Amsoshi uku dole su zama daidai; za ka iya sake gwadawa.')}</p>
                {quizResult && <div role="status" className={'quiz-score ' + (quizResult.passed ? 'passed' : '')}>{quizResult.passed ? <SealCheck size={31} weight="duotone" /> : <Info size={27} />}<div><strong>{quizResult.passed ? say('You’ve got it. Quest complete.', 'Ka fahimta. An gama darasi.') : say('A little more practice.', 'Ƙarin gwaji kaɗan.')}</strong><p>{quizResult.score}/{quizResult.total} {say('correct', 'daidai')}. {quizResult.passed ? say('Your knowledge achievement is saved.', 'An ajiye lambar iliminka.') : say('Read the explanations below, then try again.', 'Karanta bayanan da ke ƙasa, sannan sake gwada.')}</p></div></div>}
                <form onSubmit={submitQuiz} className="quiz-form">{lesson.questions.map((questionItem, index) => <fieldset key={index} className="quiz-question"><legend><span>0{index + 1}</span>{text(questionItem.prompt, language)}</legend>{questionItem.options.map((option, optionIndex) => <label key={optionIndex} className={'quiz-option ' + (answers[index] === optionIndex ? 'selected ' : '') + (quizResult && answers[index] === optionIndex ? quizResult.results[index].correct ? 'correct' : 'incorrect' : '')}><input type="radio" name={'quiz-' + index} value={optionIndex} checked={answers[index] === optionIndex} disabled={Boolean(busy)} onChange={() => { setAnswers(current => current.map((value, answerIndex) => answerIndex === index ? optionIndex : value)); setQuizResult(null); }} /><span className="radio-ring" /><span>{text(option, language)}</span>{quizResult && answers[index] === optionIndex && (quizResult.results[index].correct ? <CheckCircle size={19} /> : <X size={18} />)}</label>)}{quizResult && <p className={'quiz-feedback ' + (quizResult.results[index].correct ? 'correct' : '')}><Info size={16} />{text(quizResult.results[index].explanation, language)}</p>}</fieldset>)}
                  <div className="reader-controls"><button type="button" className="button secondary" onClick={() => goStep(2)}><ArrowLeft size={18} />{say('Review lesson', 'Duba darasi')}</button>{quizResult?.passed ? <button type="button" className="button primary" onClick={() => { const index = lessons.findIndex(value => value.id === activeLesson); index < 2 ? go('lesson', lessons[index + 1].id) : go('wallet'); }}>{activeLesson === 'lightning' ? say('Try the wallet lab', 'Gwada walat') : say('Next quest', 'Darasi na gaba')}<ArrowRight size={18} /></button> : <button className="button primary" type="submit" disabled={Boolean(busy) || answers.some(value => value < 0)}>{busy === 'quiz' ? <LoadingIcon /> : <ShieldCheck size={18} />}{!user ? say('Sign in & check answers', 'Shiga & duba amsoshi') : say('Check my answers', 'Duba amsoshina')}</button>}</div>
                  {!user && <p className="reader-note"><LockKey size={15} />{say('Sign in to save your knowledge check. Reading stays free.', 'Shiga domin ajiye amsoshi. Karanta kyauta ne.')}</p>}
                </form>
              </>}
            </article><section className="lesson-context"><div className="context-cover"><LessonArtwork id={lesson.id} /></div><div className="context-body"><Pill tone={earned.has(lesson.badgeId) ? 'sage' : 'outline'}>{earned.has(lesson.badgeId) ? <CheckCircle size={15} /> : <Medal size={15} />}{say('KNOWLEDGE ACHIEVEMENT', 'LAMBAR ILIMI')}</Pill><h3>{text(badges.find(item => item.id === lesson.badgeId)!.title, language)}</h3><p>{earned.has(lesson.badgeId) ? say('Earned through a checked quiz. This records understanding, not a wallet payment.', 'An samu daga gwajin amsoshi. Wannan yana nuna fahimta, ba biyan walat ba.') : say('Complete the knowledge check to earn this badge. Your next small win.', 'Gama gwajin amsoshi domin samun wannan lamba.')}</p><div className="context-divider" /><ChatCircleDots size={25} /><strong>{say('Something unclear?', 'Wani abu bai fito fili ba?')}</strong><p>{say('Your course guide can explain it in everyday words.', 'Jagoran darasi zai iya bayyana da sauƙaƙan kalmomi.')}</p><button className="text-button" onClick={() => go('guide')}>{say('Ask the guide', 'Tambayi jagora')}<ArrowRight size={17} /></button></div></section></div>
          </>}

          {page === 'wallet' && <>
            <div className="page-heading"><div><h1>{say('The proof is in the practice.', 'Hujjar tana cikin aiki.')}</h1><p>{say('Create a small invoice. Receive a payment. Check it yourself.', 'Ƙirƙiri invoice kaɗan. Karɓi biya. Tabbatar da kanka.')}</p></div><Pill tone="outline"><Flask size={18} />{say('HANDS-ON WALLET LAB', 'GWAJIN WALAT A AIKACE')}</Pill></div>
            <div className="lab-safety"><ShieldCheck size={21} /><p>{wallet.practice || wallet.network === 'regtest' ? say('Local regtest network. These coins have no monetary value. Payment states come from real wallet operations.', 'Hanyar regtest ta gida. Waɗannan kuɗaɗe ba su da ƙimar kuɗi. Matsayin biya yana daga walat na gaske.') : say('This exercise receives 10 sats into your own wallet. Use a second wallet on the same network. It does not request spending permission.', 'Wannan gwajin yana karɓar sats 10 a walat ɗinka. Yi amfani da walat na biyu a hanya ɗaya. Ba ya neman izinin aika kuɗi.')}</p></div>
            <div className="wallet-layout"><section className="wallet-exercise"><div className="panel-heading"><div><h2>{say('Receive. Then verify.', 'Karɓa. Sannan tabbatar.')}</h2></div><Pill tone="apricot"><Lightning size={16} weight="fill" />10 sats</Pill></div><div className="lab-step-strip"><span className={wallet.connected ? 'complete' : 'current'}>{wallet.connected ? <CheckCircle size={16} /> : '1'} {say('Connect', 'Haɗa')}</span><i /><span className={exercise ? 'complete' : wallet.connected ? 'current' : ''}>{exercise ? <CheckCircle size={16} /> : '2'} {say('Receive', 'Karɓa')}</span><i /><span className={exercise?.state === 'settled' ? 'complete' : exercise ? 'current' : ''}>{exercise?.state === 'settled' ? <CheckCircle size={16} /> : '3'} {say('Verify', 'Tabbatar')}</span></div>
              {!exercise ? <div className="exercise-start"><span className="exercise-art"><Flask size={70} weight="duotone" /><span><Lightning size={25} weight="fill" /></span></span><h3>{say('A tiny payment.', 'Ƙaramin biya.')}<br />{say('A useful bit of confidence.', 'Fahimta mai amfani.')}</h3><p>{say('Connect a Lightning wallet with invoice creation and lookup permissions. We’ll create a 10-sat request that you can pay from a second wallet.', 'Haɗa walat na Lightning mai izinin ƙirƙira da duba invoice. Za mu ƙirƙiri neman sats 10 da za ka biya daga walat na biyu.')}</p><button className="button primary" disabled={Boolean(busy) || sessionLoading || missingCapability} onClick={createExercise}>{busy === 'exercise-create' ? <LoadingIcon /> : wallet.connected ? <Lightning size={18} /> : <Wallet size={18} />}{!user ? say('Sign in to start', 'Shiga domin fara') : !wallet.connected ? say('Connect your wallet', 'Haɗa walat ɗinka') : say('Create a 10-sat invoice', 'Ƙirƙiri invoice na sats 10')}<ArrowRight size={18} /></button><span className="exercise-footnote"><LockKey size={14} />{say('No badge is awarded before verified settlement.', 'Ba a bayar da lamba kafin tabbataccen biya.')}</span>{missingCapability && <div className="inline-warning"><Info size={18} /><p>{say('Your connection needs make_invoice and lookup_invoice. Review the permissions in your wallet provider.', 'Haɗinka yana buƙatar make_invoice da lookup_invoice. Duba izini a wajen mai ba da walat.')}</p><button className="text-button" onClick={openWallet}>{say('Review connection', 'Duba haɗi')}<ArrowUpRight size={16} /></button></div>}</div> : <div className="active-exercise">
                <div className={'exercise-status ' + (exercise.state === 'settled' ? 'settled' : invoiceExpired ? 'expired' : 'pending')}>{exercise.state === 'settled' ? <SealCheck size={29} weight="duotone" /> : invoiceExpired ? <WarningCircle size={26} /> : <LoadingIcon size={24} />}<div><strong>{statusLabel}</strong><p>{exercise.state === 'settled' ? say('Checked against your receiving wallet. Lightning Explorer earned.', 'An duba a walat na karɓa. An samu Lightning Explorer.') : invoiceExpired ? say('Create a fresh invoice to practice again. You can still check this receipt.', 'Ƙirƙiri sabuwar invoice domin sake gwaji. Za ka iya duba wannan hujja.') : say('A request is not proof. We’re checking the receiving wallet.', 'Neman biya ba hujja ba ne. Ana duba walat na karɓa.')}</p></div></div>
                {verificationHint && <div className="inline-warning"><WarningCircle size={18} /><p>{verificationHint}</p></div>}<div className="invoice-stage"><div className={'invoice-qr ' + (invoiceExpired || exercise.state === 'settled' ? 'finished' : '')}>{qr ? <img src={qr} width="248" height="248" alt={say('Lightning invoice QR code for 10 sats', 'Lambar QR na invoice na sats 10')} /> : <div><LoadingIcon size={35} /><span>{say('Preparing your QR', 'Ana shirya QR')}</span></div>}{exercise.state === 'settled' && <span className="qr-stamp"><SealCheck size={22} />{say('VERIFIED', 'AN TABBATAR')}</span>}</div><div className="invoice-summary"><strong>{exercise.amountSats}<span> sats</span></strong><Pill tone="outline"><Globe size={14} />{exercise.network || wallet.network || say('Check wallet network', 'Duba hanyar walat')}</Pill><p>{say('Pay this request from a second wallet on the same network. No payment is sent by the academy.', 'Biya wannan invoice daga walat na biyu a hanya ɗaya. Academy ba ya aika kuɗi.')}</p>{exercise.state === 'pending' && <span className="expiry-note">{invoiceExpired ? say('Expired at ', 'Ya ƙare ') + displayTime(exercise.expiresAt) : say('Expires in ', 'Yana ƙarewa bayan ') + Math.max(1, Math.ceil((exercise.expiresAt - now) / 60000)) + say(' min', ' minti')}</span>}</div></div>
                <label className="field-label" htmlFor="invoice-value">{say('Lightning payment request', 'Neman biya na Lightning')} <span>BOLT11</span></label><div className="invoice-value"><textarea id="invoice-value" value={exercise.bolt11} readOnly rows={3} spellCheck={false} /><button className="icon-button" onClick={() => void copy(exercise.bolt11, 'Invoice')} aria-label={say('Copy invoice', 'Kwafa invoice')}><Copy size={21} /></button></div>
                <dl className="receipt-meta"><div><dt>{say('Payment reference', 'Bayanin biya')}</dt><dd><button onClick={() => void copy(exercise.paymentHash, say('Payment hash', 'Hash na biya'))} title={exercise.paymentHash}>{shortHash(exercise.paymentHash)}<Copy size={15} /></button></dd></div><div><dt>{say('Created', 'An ƙirƙira')}</dt><dd>{displayDate(exercise.createdAt)}</dd></div><div><dt>{exercise.state === 'settled' ? say('Verified on', 'An tabbatar') : say('Expires at', 'Yana ƙarewa')}</dt><dd>{exercise.state === 'settled' ? displayDate(exercise.settledAt) : displayTime(exercise.expiresAt)}</dd></div></dl>
                <div className="exercise-actions">{exercise.state !== 'settled' && <button className="button primary" disabled={Boolean(busy)} onClick={() => void verifyExercise()}>{busy === 'exercise-verify' ? <LoadingIcon /> : <ShieldCheck size={18} />}{say('Check payment status', 'Duba matsayin biya')}</button>}{exercise.state === 'settled' || invoiceExpired ? <button className={'button ' + (exercise.state === 'settled' ? 'primary' : 'secondary')} disabled={Boolean(busy)} onClick={() => { setExercise(null); setError(''); }}>{say('Start another exercise', 'Fara wani gwaji')}<ArrowRight size={18} /></button> : <button className="button secondary" onClick={() => { setExercise(null); setError(''); }} disabled={Boolean(busy)}>{say('Back to practice', 'Komawa gwaji')}</button>}</div>
              </div>}
            </section><div className="wallet-context"><section className="connected-wallet"><div className="panel-heading"><h3>{say('Your learning wallet', 'Walat ɗinka na koyo')}</h3><button className="icon-button" onClick={() => void refreshWallet()} disabled={!user || walletLoading || Boolean(busy)} aria-label={say('Refresh wallet status', 'Sake duba walat')}>{walletLoading ? <LoadingIcon /> : <ArrowClockwise size={20} />}</button></div>{wallet.connected ? <><Pill tone="sage"><CheckCircle size={15} weight="fill" />{say('Connected', 'An haɗa')} · NWC</Pill><div className="wallet-balance"><span>{say('Balance shared by wallet', 'Ma’aunin da walat ya raba')}</span><strong>{wallet.balanceSats === undefined ? say('Not shared', 'Ba a raba ba') : wallet.balanceSats.toLocaleString()} {wallet.balanceSats !== undefined && <small>sats</small>}</strong></div><div className="wallet-permissions">{['make_invoice', 'lookup_invoice'].map(method => <span key={method} className={(wallet.capabilities || []).includes(method) ? 'available' : ''}>{(wallet.capabilities || []).includes(method) ? <CheckCircle size={16} /> : <WarningCircle size={16} />}<code>{method}</code></span>)}</div>{missingCapability && <p className="wallet-capability-note">{say('Ask your provider for the missing permissions before starting.', 'Nemi izinin da ya rage a wajen mai ba da walat kafin fara.')}</p>}<button className="text-button" onClick={openWallet}>{say('Review connection', 'Duba haɗi')}<ArrowUpRight size={17} /></button></> : <><span className="wallet-lock"><LockKey size={32} weight="duotone" /></span><p>{say('Your wallet stays with your provider. Connect a restricted NWC connection when you are ready to practice.', 'Walat yana wajen mai ba da walat. Haɗa NWC mai ƙaramin izini idan ka shirya gwaji.')}</p><button className="button secondary full" onClick={openWallet}>{say('Connect wallet', 'Haɗa walat')}<ArrowUpRight size={17} /></button></>}{wallet.error && <p className="wallet-error"><WarningCircle size={17} />{wallet.error}</p>}</section><section className={'wallet-badge ' + (earned.has('lightning-explorer') ? 'earned' : '')}><span className="wallet-badge-emblem"><SealCheck size={54} weight="duotone" /></span><h3>Lightning Explorer</h3><p>{earned.has('lightning-explorer') ? say('Earned through verified settlement. You checked a payment, not a screenshot.', 'An samu bayan tabbataccen biya. Ka duba kuɗi, ba hoton allo ba.') : say('Complete one wallet-verified payment to earn your practical achievement.', 'Gama biya ɗaya da walat ya tabbatar domin lambar aiki.')}</p><Pill tone={earned.has('lightning-explorer') ? 'sage' : 'outline'}>{earned.has('lightning-explorer') ? <CheckCircle size={15} /> : <LockKey size={15} />}{earned.has('lightning-explorer') ? say('Earned & verified', 'An samu & an tabbatar') : say('Verification required', 'Ana buƙatar tabbatarwa')}</Pill></section><button className="wallet-help-link" onClick={() => go('lesson', 'lightning')}><BookOpen size={22} /><span>{say('Need a refresher?', 'Kana buƙatar tunatarwa?')}<strong>{say('Revisit the Lightning quest', 'Sake duba darasin Lightning')}<ArrowUpRight size={15} /></strong></span></button></div></div>
            <section className="practice-receipts"><div className="section-heading"><div><h2>{say('Every request has a story.', 'Kowane invoice yana da bayani.')}</h2></div><span className="section-note">{progress.exercises.length} {say('recent exercises', 'gwaje-gwaje na kusa')}</span></div>{progress.exercises.length ? <div className="receipt-list">{progress.exercises.map(item => <button key={item.id} className="receipt-row" onClick={() => { setExercise(item); setError(''); window.scrollTo({ top: 0, behavior: 'instant' }); }}><span className={'receipt-icon ' + item.state}>{item.state === 'settled' ? <SealCheck size={24} /> : <Lightning size={24} />}</span><span className="receipt-title"><strong>{say('Receiving exercise', 'Gwajin karɓa')}</strong><small>{displayDate(item.createdAt)} <span>·</span> {shortHash(item.paymentHash)}</small></span><strong className="receipt-amount">{item.amountSats} sats</strong><Pill tone={item.state === 'settled' ? 'sage' : item.state === 'expired' ? 'amber' : 'outline'}>{item.state === 'settled' ? say('Verified', 'An tabbatar') : item.state === 'expired' ? say('Expired', 'Ya ƙare') : say('Pending', 'Ana jira')}</Pill><ArrowUpRight size={20} /></button>)}</div> : <div className="quiet-empty"><span><Wallet size={23} /></span><div><strong>{say('Your first receipt starts here.', 'Hujjarka ta farko tana farawa a nan.')}</strong><p>{say('Create an invoice to start a practice record. Pending requests never count as verified payments.', 'Ƙirƙiri invoice domin fara bayani. Neman biya ba ya zama tabbataccen kuɗi.')}</p></div></div>}</section>
          </>}

          {page === 'achievements' && <>
            <div className="page-heading"><div><h1>{say('Your confidence, made visible.', 'Fahimtarka a bayyane.')}</h1><p>{say('Knowledge comes from checked answers. Practical skill comes from a verified payment.', 'Ilimi yana daga amsoshi daidai. Ƙwarewar aiki tana daga tabbataccen biya.')}</p></div><Pill tone="outline"><Medal size={18} />{progress.badges.length}/4 {say('earned', 'an samu')}</Pill></div>
            <div className="achievements-grid">{badges.map((badge, index) => { const isEarned = earned.has(badge.id); const record = progress.badges.find(value => value.badgeId === badge.id); const Icon = index === 0 ? GraduationCap : index === 1 ? ShieldCheck : index === 2 ? Lightning : SealCheck; return <section key={badge.id} className={'achievement-card badge-' + index + (isEarned ? ' earned' : '')}><span className="achievement-number">0{index + 1}</span><span className="achievement-emblem"><Icon size={58} weight="duotone" />{!isEarned && <span className="badge-lock"><LockKey size={17} /></span>}</span><span className="eyebrow">{badge.kind === 'verified' ? say('VERIFIED WALLET SKILL', 'TABBATACCIYAR WALAT') : say('KNOWLEDGE CHECK', 'GWAJIN ILIMI')}</span><h2>{text(badge.title, language)}</h2><p>{text(badge.description, language)}</p>{isEarned ? <div className="earned-record"><CheckCircle size={17} weight="fill" /><strong>{say('Earned', 'An samu')}</strong><span>{displayDate(record?.earnedAt)}</span></div> : <button className="button secondary" onClick={() => badge.kind === 'verified' ? go('wallet') : go('lesson', lessons[index].id)}>{badge.kind === 'verified' ? say('Try the wallet lab', 'Gwada walat') : say('Start the quest', 'Fara darasi')}<ArrowRight size={17} /></button>}</section>; })}</div>
            <div className="achievement-explainer"><ShieldCheck size={36} weight="duotone" /><div><h3>{say('An achievement should mean something.', 'Lambar nasara ta nuna ƙwarewa.')}</h3><p>{say('Quiz badges record understanding. Lightning Explorer records a payment checked against the receiving wallet. There are no cash rewards, and a quiz answer can never stand in for settlement.', 'Lambobin tambayoyi suna nuna fahimta. Lightning Explorer yana nuna biya da walat na karɓa ya tabbatar. Babu kyautar kuɗi, kuma amsa ba ta zama hujjar biya.')}</p></div><button className="text-button" onClick={() => go('wallet')}>{say('See how verification works', 'Duba tabbatarwa')}<ArrowUpRight size={17} /></button></div>
          </>}

          {page === 'guide' && <>
            <div className="page-heading"><div><h1>{say('Curiosity is welcome here.', 'Muna maraba da son sani.')}</h1><p>{say('Ask about the lessons. Your course guide will help make one idea clear.', 'Tambayi game da darussa. Jagora zai taimaka fahimtar abu ɗaya.')}</p></div><Pill tone="outline"><BookOpen size={17} />{say('GROUNDED IN THE COURSE', 'DAGA DARUSSAN')}</Pill></div>
            <div className="guide-layout"><section className="guide-chat"><div className="guide-chat-heading"><span className="guide-avatar"><Sparkle size={26} weight="duotone" /></span><div><strong>{say('Your course guide', 'Jagoran darasinka')}</strong><span>{say('Bitcoin basics, one clear answer at a time.', 'Tushen Bitcoin, amsa mai sauƙi ɗaya bayan ɗaya.')}</span></div><button className="icon-button" onClick={() => { setMessages([]); setQuestion(''); setError(''); }} disabled={!messages.length || Boolean(busy)} aria-label={say('Clear conversation', 'Share tattaunawa')}><ArrowClockwise size={21} /></button></div>
              <div className="guide-messages" aria-live="polite">{messages.length === 0 ? <div className="guide-welcome"><span><ChatCircleDots size={47} weight="duotone" /></span><h2>{say('What are you wondering?', 'Me kake son fahimta?')}</h2><p>{say('Start with a question about sats, wallet safety, invoices, or verifying a payment.', 'Fara da tambaya game da sats, tsaron walat, invoice ko tabbatar da biya.')}</p><div className="suggested-questions">{[say('Why is pending different from paid?', 'Me ya sa pending ba yana nufin an biya ba?'), say('Which wallet permissions do I need?', 'Wane izinin walat nake buƙata?'), say('How many sats are in one bitcoin?', 'Sats nawa ne a cikin Bitcoin ɗaya?')].map(value => <button key={value} disabled={Boolean(busy)} onClick={() => void askGuide(value)}>{value}<ArrowUpRight size={17} /></button>)}</div></div> : messages.map(item => <div className={'guide-message ' + item.role} key={item.id}>{item.role === 'guide' && <span className="message-avatar">s.</span>}<div><p>{item.text}</p>{item.role === 'guide' && <div className="guide-source"><BookOpen size={14} /><span>{item.mode === 'ai-tutor' ? say('AI tutor · course context', 'AI tutor · daga darasi') : say('Course guidance · not AI generated', 'Jagoran darasi · ba AI ba')}</span>{item.lessonId && getLesson(item.lessonId) && <button onClick={() => go('lesson', item.lessonId as LessonId)}>{say('Open lesson', 'Buɗe darasi')}<ArrowUpRight size={14} /></button>}</div>}</div></div>)}{busy === 'guide' && <div className="guide-thinking"><LoadingIcon size={18} />{say('Finding a clear explanation…', 'Ana neman bayani mai sauƙi…')}</div>}<div ref={guideEnd} /></div>
              <form className="guide-composer" onSubmit={event => { event.preventDefault(); void askGuide(); }}><label className="sr-only" htmlFor="guide-question">{say('Your Bitcoin question', 'Tambayarka ta Bitcoin')}</label><textarea id="guide-question" rows={2} value={question} onChange={event => setQuestion(event.target.value)} placeholder={say('Ask a small question…', 'Yi tambaya kaɗan…')} maxLength={400} disabled={busy === 'guide'} /><button className="send-guide" type="submit" disabled={Boolean(busy) || question.trim().length < 3} aria-label={say('Send question', 'Aika tambaya')}>{busy === 'guide' ? <LoadingIcon /> : <ArrowUpRight size={23} />}</button></form><div className="guide-privacy"><LockKey size={14} /><p>{say('Keep recovery words, private keys, and NWC connection strings out of this conversation.', 'Kada ka saka kalmomin dawo da walat, maballin sirri ko haɗin NWC a tattaunawa.')}</p></div>
            </section><section className="guide-note"><span className="guide-note-icon"><BookOpen size={36} weight="duotone" /></span><h3>{say('A helpful guide.', 'Jagora mai taimako.')}<br />{say('A clear boundary.', 'Iyaka a bayyane.')}</h3><p>{say('Answers come from the academy’s course material. The guide does not move money, inspect your wallet secrets, or give investment advice.', 'Amsoshi suna daga darussan academy. Jagora ba ya aika kuɗi, duba sirrin walat ko ba da shawarar zuba jari.')}</p><ul><li><CheckCircle size={17} />{say('Understand sats and Bitcoin', 'Fahimci sats da Bitcoin')}</li><li><CheckCircle size={17} />{say('Learn safe wallet habits', 'Koyi tsaron walat')}</li><li><CheckCircle size={17} />{say('Read invoice payment states', 'Fahimci matsayin invoice')}</li></ul><div className="guide-boundary-note"><Info size={18} /><p>{say('This guide uses reviewed course explanations by default. An AI tutor is identified only when an AI provider is configured.', 'Jagoran yana amfani da bayanan darasi. Ana nuna AI tutor idan an saita mai ba da AI.')}</p></div><button className="text-button" onClick={() => go('discover')}>{say('Back to the learning path', 'Komawa hanyar koyo')}<ArrowRight size={17} /></button></section></div>
          </>}

          {page === 'profile' && <>
            <div className="page-heading"><div><h1>{say('Your learning, your way.', 'Koyonka, yadda kake so.')}</h1><p>{say('A name, a language, and a clear record of what you’ve learned.', 'Suna, harshe da bayanin abin da ka koya.')}</p></div><Pill tone="outline"><UserCircle size={18} />{say('YOUR PROFILE', 'BAYANANKA')}</Pill></div>
            {!user ? <EmptyState icon={<UserCircle size={42} weight="duotone" />} title={say('A learning space to come back to.', 'Wurin koyo da za ka dawo.')} action={<button className="button primary" onClick={() => setDialog('account')}>{say('Sign in with Nostr', 'Shiga da Nostr')}<ArrowRight size={18} /></button>}>{say('Sign in to keep your quiz progress, wallet exercises, and achievements together.', 'Shiga domin ajiye amsoshi, gwajin walat da lambobin nasara a wuri ɗaya.')}</EmptyState> : <div className="profile-layout"><section className="profile-main"><div className="profile-heading"><span className="profile-avatar">{avatar}</span><div><strong>{profile.displayName}</strong><span>{temporary ? say('Temporary Nostr identity', 'Shaida ta Nostr ta wucin gadi') : user.demo ? say('Local preview identity', 'Shaidar gwajin gida') : say('Your Nostr learning identity', 'Shaidar koyonka ta Nostr')}</span></div><Pill tone="sage">{completed}/3 {say('quests', 'darussa')}</Pill></div><form className="profile-form" onSubmit={saveProfile}><label className="field-label" htmlFor="profile-name">{say('What should we call you?', 'Wane suna za mu kira ka?')}</label><input id="profile-name" className="text-input" value={displayName} onChange={event => setDisplayName(event.target.value)} required maxLength={60} autoComplete="nickname" /><label className="field-label" htmlFor="profile-language">{say('Preferred learning language', 'Harshen koyo')}</label><select id="profile-language" className="text-input" value={profileLanguage} onChange={event => setProfileLanguage(event.target.value as Language)}><option value="en">English</option><option value="ha">Hausa</option></select><p className="field-hint">{say('Hausa is a first translation draft awaiting native-speaker review.', 'Fassarar Hausa daftarin farko ne da ake jiran bitar masu harshen.')}</p><button className="button primary" type="submit" disabled={Boolean(busy)}>{busy === 'profile' ? <LoadingIcon /> : <Check size={18} />}{say('Save preferences', 'Ajiye saituna')}</button></form><div className="profile-identity"><div><strong>{say('Your Nostr public key', 'Maballinka na jama’a')}</strong><p>{say('This identifies your learning record. It is not a wallet secret.', 'Wannan yana nuna bayanan koyonka. Ba sirrin walat ba ne.')}</p></div><div className="public-key"><code>{user.pubkey}</code><button className="icon-button" onClick={() => void copy(user.pubkey, say('Public key', 'Maballin jama’a'))} aria-label={say('Copy public key', 'Kwafa maballin jama’a')}><Copy size={20} /></button></div>{temporary && <div className="inline-warning"><LockKey size={18} /><p>{hasTemporarySigningKey() ? say('This temporary signing key is held only in this tab’s memory. Use a Nostr signer for an identity you can keep.', 'Maballin wucin gadi yana cikin ƙwaƙwalwar wannan tab kawai. Yi amfani da signer domin shaida da za ka riƙe.') : say('The temporary signing key was lost on reload. Your current session still works, but you cannot return to this identity after it expires or you sign out.', 'An rasa maballin wucin gadi bayan sake buɗe shafi. Lokacin shiga yana aiki yanzu, amma ba za ka dawo da wannan shaida bayan ya ƙare ko ka fita ba.')}</p></div>}</div></section><div className="profile-actions"><section className="profile-action-card"><span className="action-icon"><DownloadSimple size={26} /></span><h3>{say('Take your learning with you.', 'Riƙe bayanan koyonka.')}</h3><p>{say('Download your profile, progress, achievements, all wallet exercise receipts, and the latest 100 quiz attempts as JSON. Wallet secrets are excluded.', 'Sauke bayananka, ci gaban darasi, lambobi, duk hujjojin walat da gwaje-gwaje 100 na kusa a JSON. Ba a haɗa sirrin walat.')}</p><button className="button secondary full" onClick={() => void exportLearning()} disabled={Boolean(busy)}>{busy === 'export' ? <LoadingIcon /> : <DownloadSimple size={18} />}{say('Download learning record', 'Sauke bayanan koyo')}</button></section><section className="profile-action-card reset-card"><h3>{say('A fresh look at the lessons.', 'Sake farawa da darussa.')}</h3><p>{say('Reset quiz progress and knowledge badges. Verified payment receipts and your Lightning Explorer badge stay in your record.', 'Sake saita amsoshi da lambobin ilimi. Hujjar biya da lambar Lightning Explorer suna nan.')}</p><button className="text-button" onClick={() => { setResetText(''); setError(''); setDialog('reset'); }} disabled={Boolean(busy)}>{say('Reset lessons', 'Sake saita darussa')}<ArrowClockwise size={17} /></button></section><button className="signout-button" disabled={Boolean(busy)} onClick={() => void logout()}>{busy === 'logout' ? <LoadingIcon /> : <SignOut size={21} />}{say('Sign out', 'Fita')}<ArrowUpRight size={17} /></button></div></div>}
          </>}

          {page === 'notfound' && <EmptyState icon={<BookOpen size={39} />} title={say('This chapter hasn’t been written.', 'Wannan shafi bai samu ba.')} action={<button className="button primary" onClick={() => go('discover')}>{say('Back to the learning path', 'Komawa hanyar koyo')}<ArrowRight size={18} /></button>}>{say('That page could not be found. Your learning path is right here.', 'Ba a samu wannan shafi ba. Hanyar koyonka tana nan.')}</EmptyState>}
        </main><div className="container"><Footer onGuide={() => go('guide')} onHelp={() => setDialog('help')} /></div>
        <nav className="phone-nav" aria-label={say('Learning navigation', 'Hanyoyin koyo')}>{[...nav, { page: 'profile' as const, label: say('Profile', 'Bayanai'), mobile: say('You', 'Ni'), icon: UserCircle }].map(item => <button key={item.page} onClick={() => go(item.page)} aria-current={page === item.page || page === 'lesson' && item.page === 'discover' ? 'page' : undefined} className={page === item.page || page === 'lesson' && item.page === 'discover' ? 'active' : ''}><item.icon size={23} weight={page === item.page ? 'fill' : 'regular'} /><span>{item.mobile}</span></button>)}</nav>
      </>}
    </div>

    {dialog && <Modal key={dialog} onClose={closeDialog} wide={dialog === 'help'}>
      {dialog === 'account' && <><span className="dialog-emblem"><UserCircle size={37} weight="duotone" /></span><h2 id="dialog-title">{user ? say('Your learning identity.', 'Shaidar koyonka.') : say('A space to come back to.', 'Wurin da za ka dawo.')}</h2><p>{say('Sign in with a Nostr identity to save lessons, achievements, and wallet practice. Your wallet connects separately.', 'Shiga da shaidar Nostr domin ajiye darussa, lambobi da gwajin walat. Ana haɗa walat dabam.')}</p>{user && <div className="signed-in-info"><CheckCircle size={20} /><span>{say('Currently signed in as ', 'An shiga da ') + profile.displayName}</span></div>}<button className="button primary full" disabled={Boolean(busy)} onClick={() => void login('nostr')}>{busy === 'login-nostr' ? <LoadingIcon /> : <ShieldCheck size={19} />}{providers.connect ? say('Continue with Connect', 'Ci gaba da Connect') : say('Continue with Nostr signer', 'Ci gaba da signer na Nostr')}<ArrowRight size={18} /></button><div className="signer-status" role="status"><span className={'tiny-dot ' + (providers.connect || providers.nip07 ? '' : 'amber')} /><span>{providers.connect ? say('Connect is ready for this website.', 'Connect ya shirya ga wannan shafi.') : providers.nip07 ? say('Your Nostr signer is ready.', 'Signer na Nostr ya shirya.') : say('Enable a signer here, then retry sign-in.', 'Ba signer izini a nan, sannan sake shiga.')}</span></div><details className="signer-setup"><summary>{say('Set up Connect for this website', 'Shirya Connect ga wannan shafi')}<CaretDown size={17} /></summary><ol><li><a href={CONNECT_INSTALL_URL} target="_blank" rel="noopener noreferrer">{say('Install Connect on desktop Chrome, Brave, or Edge.', 'Sanya Connect a Chrome, Brave ko Edge na kwamfuta.')}<ArrowUpRight size={14} /></a></li><li>{say('Open Connect from your browser toolbar and unlock it.', 'Buɗe Connect daga saman burauzarka kuma buɗe makullinsa.')}</li><li>{say('Open Connections → Enable for current website and allow access. Return here and retry sign-in.', 'Buɗe Connections → Enable for current website kuma ba da izini. Dawo nan ka sake shiga.')}</li></ol><p>{say('Connect keeps your sign-in identity. Your learning wallet connects separately below.', 'Connect yana riƙe shaidar shiga. Ana haɗa walat na koyo dabam.')}</p></details><div className="dialog-separator"><span>{say('or try it first', 'ko gwada tukuna')}</span></div><button className="button secondary full" disabled={Boolean(busy)} onClick={() => void login('temporary')}>{busy === 'login-temporary' ? <LoadingIcon /> : <Sparkle size={18} />}{say('Try a temporary identity', 'Gwada shaida ta wucin gadi')}<ArrowUpRight size={17} /></button><div className="dialog-info"><LockKey size={20} /><p>{say('A real signed identity for trying the product. Its signing key stays only in this tab’s memory and cannot be recovered after it is lost. Use an existing Nostr signer for an identity you can keep.', 'Shaida mai sa hannu domin gwada manhaja. Maballinta yana cikin ƙwaƙwalwar wannan tab kawai kuma ba za a dawo da shi idan ya ɓace ba. Yi amfani da signer domin shaida ta dindindin.')}</p></div>{demoEnabled && <button className="text-button centered" disabled={Boolean(busy)} onClick={() => void login('preview')}>{busy === 'login-preview' ? <LoadingIcon /> : <Flask size={17} />}{say('Open local learning preview', 'Buɗe gwajin koyo na gida')}</button>}<p className="dialog-smallprint">{say('No recovery phrases. No private-key forms. Only a signed identity request.', 'Ba kalmomin dawo da walat. Ba fom na maballin sirri. Neman shaida mai sa hannu kawai.')}</p></>}

      {dialog === 'onboarding' && <><span className="dialog-emblem apricot"><GraduationCap size={36} weight="duotone" /></span><h2 id="dialog-title">{say('Make yourself at home.', 'Ka ji daɗin wurin.')}</h2><p>{say('Choose a name and your learning language. You can change both in your profile anytime.', 'Zaɓi suna da harshen koyo. Za ka iya canja su a bayananka duk lokacin da kake so.')}</p><form className="dialog-form" onSubmit={event => void saveProfile(event, true)}><label className="field-label" htmlFor="onboarding-name">{say('What should we call you?', 'Wane suna za mu kira ka?')}</label><input data-first-focus id="onboarding-name" className="text-input" value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder={say('Your name or nickname', 'Sunanka ko laƙabi')} required maxLength={60} autoComplete="nickname" /><label className="field-label" htmlFor="onboarding-language">{say('Learning language', 'Harshen koyo')}</label><select id="onboarding-language" className="text-input" value={profileLanguage} onChange={event => setProfileLanguage(event.target.value as Language)}><option value="en">English</option><option value="ha">Hausa</option></select><p className="field-hint">{say('Hausa translations await native-speaker review.', 'Fassarar Hausa tana jiran bitar masu harshen.')}</p><button type="submit" className="button primary full" disabled={Boolean(busy)}>{busy === 'profile' ? <LoadingIcon /> : <Sparkle size={18} />}{say('Make it my learning space', 'Buɗe wurin koyona')}<ArrowRight size={18} /></button></form></>}

      {dialog === 'wallet' && <><span className="dialog-emblem"><Wallet size={35} weight="duotone" /></span><h2 id="dialog-title">{wallet.connected ? say('Your learning wallet.', 'Walat ɗinka na koyo.') : say('Bring your own wallet.', 'Haɗa walat ɗinka.')}</h2><p>{say('Create a restricted Nostr Wallet Connect connection with your Lightning wallet provider. This lab receives payments; it does not send them.', 'Ƙirƙiri haɗin NWC mai ƙaramin izini a wajen mai ba da walat na Lightning. Gwajin yana karɓar biya; ba ya aikawa.')}</p><div className="permission-checklist"><strong>{say('What this exercise needs', 'Abin da gwajin yake buƙata')}</strong><span><CheckCircle size={18} /><code>make_invoice</code><small>{say('Create a receiving request', 'Ƙirƙiri neman karɓa')}</small></span><span><CheckCircle size={18} /><code>lookup_invoice</code><small>{say('Check payment settlement', 'Duba tabbataccen biya')}</small></span><span className="optional"><Info size={17} /><code>get_balance</code><small>{say('Optional', 'Zaɓi ne')}</small></span></div><form className="dialog-form" onSubmit={connectWallet}><label className="field-label" htmlFor="wallet-connection">{wallet.connected ? say('Replace connection', 'Sauya haɗi') : say('NWC connection URI', 'Haɗin NWC')}</label><input id="wallet-connection" className="text-input" type="password" value={connection} onChange={event => setConnection(event.target.value)} placeholder="nostr+walletconnect://…" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={4096} required /><p className="field-hint">{say('This is a delegated secret. It is cleared from the form immediately and stored encrypted on the server.', 'Wannan sirrin izini ne. Ana cire shi daga fom nan take kuma ajiye shi a ɓoye a server.')}</p><button className="button primary full" type="submit" disabled={Boolean(busy) || !connection.trim()}>{busy === 'wallet-connect' ? <LoadingIcon /> : <Wallet size={18} />}{wallet.connected ? say('Replace connection', 'Sauya haɗi') : say('Connect Lightning wallet', 'Haɗa walat na Lightning')}</button></form>{wallet.connected && <button className="button danger-quiet full" disabled={Boolean(busy)} onClick={() => void disconnectWallet()}>{busy === 'wallet-disconnect' ? <LoadingIcon /> : <SignOut size={17} />}{say('Disconnect wallet', 'Cire haɗin walat')}</button>}{demoEnabled && lightningLabReady && <button className="text-button centered" disabled={Boolean(busy)} onClick={() => void connectLocalWallet()}>{busy === 'wallet-local' ? <LoadingIcon /> : <Flask size={17} />}{say('Use local regtest wallet · no monetary value', 'Yi amfani da regtest · babu ƙimar kuɗi')}</button>}<div className="dialog-info"><ShieldCheck size={20} /><p>{say('Never enter recovery words or a wallet master key. Revoke unused NWC connections in your wallet provider. Payment permission is not needed here.', 'Kada ka saka kalmomin dawo da walat ko babban maballinta. Cire haɗin NWC da ba a amfani da shi a wajen mai ba da walat. Ba a buƙatar izinin aika a nan.')}</p></div></>}

      {dialog === 'reset' && <><span className="dialog-emblem amber"><ArrowClockwise size={34} /></span><h2 id="dialog-title">{say('Reset your lessons?', 'Sake saita darussanka?')}</h2><p>{say('This clears quiz attempts, lesson progress, and knowledge badges. Verified wallet receipts and your Lightning Explorer achievement are retained. Your wallet connection and signed-in session stay active.', 'Wannan yana share gwajin amsoshi, ci gaban darasi da lambobin ilimi. Hujjojin biya da Lightning Explorer suna nan. Haɗin walat da lokacin shiga suna nan.')}</p><form className="dialog-form" onSubmit={resetLessons}><label className="field-label" htmlFor="reset-confirm">{say('Type RESET to confirm', 'Rubuta RESET domin tabbatarwa')}</label><input data-first-focus id="reset-confirm" className="text-input" value={resetText} onChange={event => setResetText(event.target.value)} autoComplete="off" spellCheck={false} maxLength={10} placeholder="RESET" /><div className="dialog-action-row"><button type="button" className="button secondary" onClick={closeDialog}>{say('Keep my lessons', 'Riƙe darussana')}</button><button type="submit" className="button danger" disabled={Boolean(busy) || resetText !== 'RESET'}>{busy === 'reset' ? <LoadingIcon /> : <ArrowClockwise size={17} />}{say('Reset lessons', 'Sake saita')}</button></div></form></>}

      {dialog === 'help' && <><span className="dialog-emblem apricot"><BookOpen size={36} weight="duotone" /></span><h2 id="dialog-title">{say('Learn a little. Do a lot.', 'Koyi kaɗan. Yi aiki.')}</h2><p>{say('SatsAcademy is an open-source learning space for first-time Bitcoin users in Nigeria and West Africa. It turns theoretical lessons into practical wallet habits.', 'SatsAcademy wurin koyo ne na open-source ga masu fara Bitcoin a Najeriya da Afirka ta Yamma. Yana sa darussa su zama halayen walat a aikace.')}</p><ol className="help-steps"><li><span>01</span><div><strong>{say('Three short quests', 'Darussa uku gajeru')}</strong><p>{say('Understand sats, wallet control, and Lightning payment states. Complete checked quizzes in English or Hausa.', 'Fahimci sats, ikon walat da matsayin biya na Lightning. Amsa tambayoyi da English ko Hausa.')}</p></div></li><li><span>02</span><div><strong>{say('One hands-on exercise', 'Gwaji ɗaya a aikace')}</strong><p>{say('Connect a limited NWC wallet, create a 10-sat invoice, and pay it from another wallet on the same network.', 'Haɗa NWC mai ƙaramin izini, ƙirƙiri invoice na sats 10 kuma biya daga wani walat a hanya ɗaya.')}</p></div></li><li><span>03</span><div><strong>{say('A verified achievement', 'Tabbatacciyar lambar nasara')}</strong><p>{say('The receiving wallet must confirm the matching amount and hash are settled. No screenshot or user-submitted paid flag is enough.', 'Walat na karɓa dole ya tabbatar da adadi da hash kuma an biya. Hoton allo ko danna “na biya” ba su isa ba.')}</p></div></li></ol><div className="dialog-info"><Info size={21} /><p>{say('This is a hackathon MVP. Hausa content awaits native-speaker review, lesson times are estimates, and independent learner adoption has not yet been measured. Learning is free; wallet providers may charge fees.', 'Wannan MVP na hackathon ne. Hausa tana jiran bitar masu harshen, lokacin darasi kimanta ne, kuma ba a auna masu koyo na waje ba. Koyo kyauta ne; mai ba da walat na iya cajin kuɗi.')}</p></div><button className="button primary" onClick={() => { setDialog(null); go('discover'); }}>{say('Explore the learning path', 'Duba hanyar koyo')}<ArrowRight size={18} /></button></>}
      {error && <div className="dialog-error" role="alert"><WarningCircle size={20} /><p>{error}</p></div>}
    </Modal>}
    {toast && <div className={'toast ' + (page === 'landing' ? 'landing-toast' : '')} role="status"><CheckCircle size={21} /><span>{toast}</span><button className="icon-button" onClick={() => setToast('')} aria-label={say('Dismiss notification', 'Rufe sanarwa')}><X size={17} /></button></div>}
  </div>;
}
