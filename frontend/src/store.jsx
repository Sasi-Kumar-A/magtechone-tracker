import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, session } from './lib/api.js';
import { notificationsFor } from './lib/rules.js';

const Ctx = createContext(null);
export const useTracker = () => useContext(Ctx);

const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

const prefersDark = () => !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

export function useTheme() {
  const [theme, setThemeState] = useState(() => read('mt-theme', 'light'));
  const [sysDark, setSysDark] = useState(prefersDark);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSysDark(mq.matches);
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on));
  }, []);
  const effective = theme === 'system' ? (sysDark ? 'dark' : 'light') : theme;
  useEffect(() => {
    // Our own attribute, so a host page that sets data-theme can't override the user's choice.
    document.documentElement.setAttribute('data-mt-theme', effective);
  }, [effective]);
  const setTheme = (t) => { setThemeState(t); write('mt-theme', t); };
  return { theme, setTheme, effective };
}

export function TrackerProvider({ children }) {
  // Last data seen on this device (no password hashes): shown instantly, then refreshed.
  const [data, setData] = useState(() => {
    try { const c = JSON.parse(localStorage.getItem('mt-cache-v1')); if (c && session.get() && c.user === session.get()?.user?.id) return c.data; } catch { /* ignore */ }
    return { testcases: [], bugs: [], team: [], modules: [] };
  });
  const [user, setUser] = useState(() => session.get()?.user || null);
  useEffect(() => {
    if (!user || !data.team.length) return;
    try { localStorage.setItem('mt-cache-v1', JSON.stringify({ user: user.id, data })); } catch { /* full or blocked */ }
  }, [data, user]);
  const [loading, setLoading] = useState(() => !!session.get() && !localStorage.getItem('mt-cache-v1'));
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState([]);
  const [lastSync, setLastSync] = useState(null);
  const [seenAt, setSeenAt] = useState('');
  const tid = useRef(0);
  const themeApi = useTheme();

  const toast = useCallback((text, kind = 'ok') => {
    const id = ++tid.current;
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 6000 : 3500);
  }, []);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const logout = useCallback(() => {
    api.logout();
    setUser(null);
    setLastSync(null);
    setToasts([]);
    setData({ testcases: [], bugs: [], team: [], modules: [] });
    try { localStorage.removeItem('mt-cache-v1'); } catch { /* ignore */ }
  }, []);

  const reload = useCallback(async (quiet) => {
    if (!session.get()) return;
    try {
      if (!quiet) setLoading(true);
      const d = await api.load();
      setData(d);
      setError('');
      setLastSync(new Date());
      const me = d.team.find((m) => m.id === session.get()?.user?.id);
      if (me) setUser(me);
    } catch (e) {
      if (e.status === 401) { logout(); return; }
      setError(e.message || 'Could not load data');
    } finally {
      setLoading(false);
    }
  }, [logout]);

  useEffect(() => { if (user) reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);

  // Live mode: refresh every 30 s so everyone sees each other's changes.
  useEffect(() => {
    if (api.mode !== 'live' || !user) return undefined;
    const t = setInterval(() => { if (document.visibilityState === 'visible') reload(true); }, 30000);
    return () => clearInterval(t);
  }, [reload, user]);

  useEffect(() => { if (user) setSeenAt(read(`mt-seen-${user.id}`, '')); }, [user?.id]);

  const login = async (loginName, password, token) => {
    const u = await api.login(loginName, password, token);
    setUser(u);
    return u;
  };

  const notifications = useMemo(() => notificationsFor(user, data.bugs, data.team), [user, data.bugs, data.team]);
  const unread = notifications.filter((n) => n.at > seenAt).length;
  const markAllRead = () => {
    const at = notifications[0]?.at || new Date().toISOString();
    setSeenAt(at);
    if (user) write(`mt-seen-${user.id}`, at);
  };

  // Tell people about new notifications that arrive while they work.
  const prevKeys = useRef(null);
  useEffect(() => {
    if (!lastSync) { prevKeys.current = null; return; }
    const keys = new Set(notifications.map((n) => n.key));
    if (prevKeys.current) {
      const fresh = notifications.filter((n) => !prevKeys.current.has(n.key));
      if (fresh.length) toast(fresh.length === 1 ? fresh[0].text : `${fresh.length} new notifications`);
    }
    prevKeys.current = keys;
  }, [notifications, toast, lastSync]);

  const replace = (key, rec) => setData((d) => ({ ...d, [key]: d[key].some((x) => x.id === rec.id) ? d[key].map((x) => (x.id === rec.id ? rec : x)) : [...d[key], rec] }));

  const run = async (fn, okText) => {
    try {
      const r = await fn();
      if (okText) toast(typeof okText === 'function' ? okText(r) : okText);
      return r;
    } catch (e) {
      if (e.status === 401) { toast('Your session ended. Please sign in again.', 'err'); logout(); return null; }
      toast(e.message || 'Something went wrong', 'err');
      if (e.status === 409) reload(true);
      return null;
    }
  };

  const actions = {
    createTestCase: (tc) => run(async () => { const r = await api.createTestCase(tc); replace('testcases', r); return r; }, (r) => `${r.id} added`),
    // Updates show on screen immediately and save in the background; undone if the save fails.
    updateTestCase: async (tc, msg) => {
      const prev = data.testcases.find((x) => x.id === tc.id);
      if (prev) { const { _action, ...clean } = tc; replace('testcases', { ...prev, ...clean }); }
      const r = await run(async () => { const res = await api.updateTestCase(tc); replace('testcases', res); return res; }, msg || ((x) => `${x.id} saved`));
      if (!r && prev) replace('testcases', prev);
      return r;
    },
    createBug: (bug) => run(async () => {
      const r = await api.createBug(bug);
      replace('bugs', r);
      if (r.testCaseId) reload(true);
      return r;
    }, (r) => `${r.id} reported`),
    updateBug: async (bug, msg) => {
      const prev = data.bugs.find((x) => x.id === bug.id);
      if (prev) replace('bugs', { ...prev, ...bug });
      const r = await run(async () => { const res = await api.updateBug(bug); replace('bugs', res); return res; }, msg || ((x) => `${x.id} updated`));
      if (!r && prev) replace('bugs', prev);
      return r;
    },
    saveTeam: (team) => run(async () => { const r = await api.saveTeam(team); setData((d) => ({ ...d, team: r })); return r; }, 'Team saved'),
    saveModules: (mods) => run(async () => { const r = await api.saveModules(mods); setData((d) => ({ ...d, modules: r })); return r; }, 'Modules saved'),
    importData: (payload) => run(async () => { const r = await api.importData(payload); setData(r); return r; }),
    changePassword: (cur, next) => run(() => api.changePassword(cur, next), 'Password changed'),
    resetDemo: api.reset ? () => run(async () => { const r = await api.reset(); setData(r); return r; }, 'Demo data reset') : null,
  };

  const value = useMemo(() => ({
    ...data, loading, error, user, login, logout, actions, toast, toasts, dismiss, reload, lastSync,
    mode: api.mode, modeLabel: api.label, notifications, unread, seenAt, markAllRead, ...themeApi,
  }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [data, loading, error, user, toasts, lastSync, notifications, unread, seenAt, themeApi.theme, themeApi.effective]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
