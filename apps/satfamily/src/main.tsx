import React, { Component, Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import Landing from './Landing';
import Legal from './Legal';
import { GreyMark } from './Brand';

const Workspace = lazy(async () => { const [module] = await Promise.all([import('./App'), import('./styles.css')]); return module; });
class ProductErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className="route-error" role="alert"><GreyMark size={44} /><h1>The page couldn’t load.</h1><p>Reload to try again. Your confirmed payments and company records stay on the server.</p><div className="route-error-actions"><button onClick={() => location.reload()}>Reload page</button><a href="/">GreyFinance home</a></div></div> : this.props.children;
  }
}
const currentPath = () => location.pathname.replace(/\/+$/, '') || '/';
function Product() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => { const changed = () => { setPath(currentPath()); window.scrollTo(0, 0); }; window.addEventListener('popstate', changed); return () => window.removeEventListener('popstate', changed); }, []);
  const navigate = (next: string) => { history.pushState({}, '', next); setPath(next); window.scrollTo(0, 0); };
  useEffect(() => { document.title = path === '/app' || path === '/satfamily' ? 'GreyFinance · Company workspace' : ['privacy', 'security', 'terms'].includes(path.slice(1)) ? `GreyFinance · ${path.slice(1)[0].toUpperCase()}${path.slice(2)}` : 'GreyFinance · Bitcoin treasury for teams'; }, [path]);
  const loading = <div className="route-loading" role="status"><div><GreyMark size={44} /><p>Opening your workspace…</p></div></div>;
  return <ProductErrorBoundary key={path}><Suspense fallback={loading}>{path === '/' ? <Landing navigate={navigate} /> : path === '/app' || path === '/satfamily' ? <Workspace onHome={() => navigate('/')} /> : ['privacy', 'security', 'terms'].includes(path.slice(1)) ? <Legal page={path.slice(1) as 'privacy' | 'security' | 'terms'} navigate={navigate} /> : <div className="route-error"><GreyMark size={44} /><p>404 · Page not found</p><h1>Let’s get you back.</h1><p>This page isn’t available. Your company workspace is one click away.</p><div className="route-error-actions"><a href="/" onClick={event => { event.preventDefault(); navigate('/'); }}>GreyFinance home</a><a href="/app" onClick={event => { event.preventDefault(); navigate('/app'); }}>Open workspace</a></div></div>}</Suspense></ProductErrorBoundary>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><Product /></React.StrictMode>);
