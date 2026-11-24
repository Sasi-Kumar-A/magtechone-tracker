import { useEffect, useRef, useState } from 'react';
import { TrackerProvider, useTracker } from './store.jsx';
import { Avatar, Icon, Toasts } from './components/ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import TestCases from './pages/TestCases.jsx';
import Bugs from './pages/Bugs.jsx';
import Team from './pages/Team.jsx';
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';
import TestCaseDrawer from './components/TestCaseDrawer.jsx';
import BugDrawer from './components/BugDrawer.jsx';
import BugForm from './components/BugForm.jsx';
import ImportModal from './components/ImportModal.jsx';
import Notifications from './components/Notifications.jsx';

const ROUTES = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'testcases', label: 'Test cases', icon: 'tests' },
  { id: 'bugs', label: 'Bugs', icon: 'bug' },
  { id: 'team', label: 'Team', icon: 'team' },
  { id: 'prefs', label: 'Settings', icon: 'gear' },
];

function useRoute() {
  const read = () => {
    const h = window.location.hash.replace('#', '');
    return ROUTES.some((r) => r.id === h) ? h : 'dashboard';
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (id) => {
    if (window.location.hash !== `#${id}`) window.location.hash = id;
    setRoute(id);
    window.scrollTo({ top: 0 });
  };
  return [route, go];
}

function UserMenu({ go }) {
  const { user, logout } = useTracker();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="umenu" ref={ref}>
      <button className="ubtn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Avatar name={user?.name} size={32} />
        <span className="uname"><strong>{user?.name}</strong><small>{user?.role}</small></span>
      </button>
      {open && (
        <div className="umenu-panel" role="menu">
          <div className="umenu-who"><strong>{user?.name}</strong><span className="muted small">@{user?.id}{user?.email ? ` · ${user.email}` : ''}</span></div>
          <button role="menuitem" onClick={() => { setOpen(false); go('prefs'); }}><Icon name="gear" /> Settings &amp; password</button>
          <button role="menuitem" onClick={() => { setOpen(false); go('team'); }}><Icon name="team" /> Team</button>
          <button role="menuitem" className="danger" onClick={logout}><Icon name="logout" /> Sign out</button>
        </div>
      )}
    </div>
  );
}

function Shell() {
  const { user, toasts, dismiss, loading, error, reload, team, effective, setTheme } = useTracker();
  const [route, go] = useRoute();
  const [q, setQ] = useState('');
  const [testId, setTestId] = useState(null);
  const [bugId, setBugId] = useState(null);
  const [bugForm, setBugForm] = useState(null);
  const [importing, setImporting] = useState(false);

  if (!user) return (<><Login /><Toasts items={toasts} onDismiss={dismiss} /></>);

  const openTest = (id) => { setBugId(null); setTestId(id); };
  const openBug = (id) => { setTestId(null); setBugId(id); };

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#dashboard" onClick={(e) => { e.preventDefault(); go('dashboard'); }}>
          <span className="logo" aria-hidden="true">M</span>
          <span className="brand-name">MagtechOne <b>Tracker</b></span>
        </a>
        <form className="top-search" role="search" onSubmit={(e) => { e.preventDefault(); if (route !== 'testcases' && route !== 'bugs') go('bugs'); }}>
          <Icon name="search" />
          <label htmlFor="global-q" className="sr">Search test cases and bugs</label>
          <input id="global-q" type="search" placeholder="Search bugs and test cases" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <div className="top-right">
          <button className="icon-btn on-dark" onClick={() => setTheme(effective === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${effective === 'dark' ? 'light' : 'dark'} theme`}>
            <Icon name={effective === 'dark' ? 'sun' : 'moon'} />
          </button>
          <Notifications openBug={openBug} />
          <UserMenu go={go} />
        </div>
      </header>

      <div className="layout">
        <nav className="nav" aria-label="Main">
          {ROUTES.map((r) => (
            <a key={r.id} href={`#${r.id}`} className={route === r.id ? 'active' : ''} aria-current={route === r.id ? 'page' : undefined}
              onClick={(e) => { e.preventDefault(); go(r.id); }}>
              <Icon name={r.icon} /><span>{r.label}</span>
            </a>
          ))}
          <div className="nav-foot">
            <button className="btn primary block" onClick={() => setBugForm({})}><Icon name="bug" /> Report bug</button>
          </div>
        </nav>

        <main className="main" id="main">
          {error ? (
            <div className="card error-card">
              <h2>Could not load data</h2>
              <p>{error}</p>
              <button className="btn primary" onClick={() => reload()}>Try again</button>
            </div>
          ) : loading && team.length === 0 ? (
            <div className="page"><div className="skeleton tall" /><div className="skeleton" /></div>
          ) : (
            <>
              {route === 'dashboard' && <Dashboard openBug={openBug} openTest={openTest} go={go} />}
              {route === 'testcases' && <TestCases q={q} setQ={setQ} openTest={openTest} openImport={() => setImporting(true)} />}
              {route === 'bugs' && <Bugs q={q} setQ={setQ} openBug={openBug} openTest={openTest} newBug={() => setBugForm({})} openImport={() => setImporting(true)} />}
              {route === 'team' && <Team />}
              {route === 'prefs' && <Settings />}
            </>
          )}
        </main>
      </div>

      <button className="fab" onClick={() => setBugForm({})} aria-label="Report bug"><Icon name="bug" /></button>
      {testId && <TestCaseDrawer id={testId} onClose={() => setTestId(null)} openBug={openBug} onReportBug={(tc) => setBugForm({ fromTest: tc })} />}
      {bugId && <BugDrawer id={bugId} onClose={() => setBugId(null)} openTest={openTest} />}
      {bugForm && <BugForm fromTest={bugForm.fromTest} onClose={() => setBugForm(null)} onCreated={(id) => { setBugForm(null); setTestId(null); setBugId(id); }} />}
      {importing && <ImportModal onClose={() => setImporting(false)} />}
      <Toasts items={toasts} onDismiss={dismiss} />
    </div>
  );
}

export default function App() {
  return (
    <TrackerProvider>
      <Shell />
    </TrackerProvider>
  );
}
