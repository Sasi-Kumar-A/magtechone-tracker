// Data access. Two adapters with the same interface:
//  - restApi: talks to the Java backend, which stores everything in the GitHub repo.
//  - demoApi: keeps data in this browser only (preview without a backend).
import seed from '../demo/seed.json';
import { canClose, closeBlockReason, historyEntry, nextBugId, nowIso, MODULE_CODE_RE, DEFAULT_PASSWORD } from './rules.js';

const API_URL = import.meta.env.VITE_API_URL || '';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key, val) { try { if (val == null) localStorage.removeItem(key); else localStorage.setItem(key, val); } catch { /* no storage */ } }

const TOKEN_KEY = 'mt-session';
export const session = {
  get() { try { return JSON.parse(safeGet(TOKEN_KEY)) || null; } catch { return null; } },
  set(s) { safeSet(TOKEN_KEY, s ? JSON.stringify(s) : null); },
};

const publicMember = ({ password, ...m }) => m;

// ---------------------------------------------------------------- REST (live)
function restApi(base) {
  async function call(method, path, body) {
    const s = session.get();
    let res;
    try {
      res = await fetch(base.replace(/\/$/, '') + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(s?.token ? { Authorization: `Bearer ${s.token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, 'Cannot reach the tracker server. Check your connection.');
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) throw new ApiError(res.status, (data && data.error) || res.statusText);
    return data;
  }
  return {
    mode: 'live',
    label: 'GitHub repository (live)',
    async login(login, password) {
      const r = await call('POST', '/api/login', { login, password });
      session.set(r);
      return r.user;
    },
    me: () => call('GET', '/api/me'),
    logout() { session.set(null); },
    changePassword: (current, next) => call('PUT', '/api/me/password', { current, next }),
    load: () => call('GET', '/api/all'),
    createTestCase: (tc) => call('POST', '/api/testcases', tc),
    updateTestCase: (tc) => call('PUT', `/api/testcases/${encodeURIComponent(tc.id)}`, tc),
    createBug: (bug) => call('POST', '/api/bugs', bug),
    updateBug: (bug) => call('PUT', `/api/bugs/${encodeURIComponent(bug.id)}`, bug),
    saveTeam: (team) => call('PUT', '/api/team', team),
    saveModules: (mods) => call('PUT', '/api/modules', mods),
    importData: (payload) => call('POST', '/api/import', payload),
    reset: null,
  };
}

// ---------------------------------------------------------------- Demo (browser only)
const DEMO_KEY = 'mt-demo-v3';

function demoApi() {
  let db;
  try { db = JSON.parse(safeGet(DEMO_KEY)) || null; } catch { db = null; }
  if (!db) db = JSON.parse(JSON.stringify(seed));
  const persist = () => safeSet(DEMO_KEY, JSON.stringify(db));
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const me = () => {
    const s = session.get();
    const u = s && db.team.find((m) => m.id === s.user?.id);
    if (!u) throw new ApiError(401, 'Please sign in again.');
    return u;
  };
  const view = () => ({ testcases: db.testcases, bugs: db.bugs, modules: db.modules, team: db.team.map(publicMember) });
  const delay = (v) => new Promise((r) => setTimeout(() => r(clone(v)), 90));
  const moduleOk = (code) => db.modules.some((m) => m.code === code);

  function checkFresh(list, rec) {
    const cur = list.find((x) => x.id === rec.id);
    if (!cur) throw new ApiError(404, `${rec.id} not found`);
    if (rec.updatedAt && cur.updatedAt !== rec.updatedAt) {
      const who = db.team.find((m) => m.id === cur.updatedBy);
      throw new ApiError(409, `${rec.id} was changed by ${who ? who.name : cur.updatedBy} meanwhile. Reload and try again.`);
    }
    return cur;
  }

  function linkBug(tcId, bugId, by) {
    db.testcases = db.testcases.map((t) => (t.id === tcId
      ? { ...t, bugIds: [...new Set([...(t.bugIds || []), bugId])], history: [historyEntry(by, `Linked bug ${bugId}`), ...(t.history || [])] }
      : t));
  }

  return {
    mode: 'demo',
    label: 'Demo (this browser only)',
    async login(login, password) {
      const l = String(login).trim().toLowerCase();
      const u = db.team.find((m) => m.id.toLowerCase() === l || (m.email || '').toLowerCase() === l);
      if (!u || u.password !== password) throw new ApiError(401, 'Wrong username/email or password.');
      const user = publicMember(u);
      session.set({ token: 'demo', user });
      return delay(user);
    },
    async me() { return delay({ user: publicMember(me()) }); },
    logout() { session.set(null); },
    async changePassword(current, next) {
      const u = me();
      if (u.password !== current) throw new ApiError(400, 'Current password is wrong.');
      if (String(next).length < 8) throw new ApiError(400, 'New password needs at least 8 characters.');
      u.password = next; persist();
      return delay({ ok: true });
    },
    load: () => { me(); return delay(view()); },
    async createTestCase(tc) {
      const u = me();
      if (db.testcases.some((t) => t.id === tc.id)) throw new ApiError(409, `${tc.id} already exists`);
      if (!moduleOk(tc.module)) throw new ApiError(400, `Unknown module ${tc.module}`);
      const at = nowIso();
      const rec = { ...tc, createdBy: u.id, updatedAt: at, updatedBy: u.id, history: [historyEntry(u.id, 'Created')] };
      db.testcases.push(rec); persist();
      return delay(rec);
    },
    async updateTestCase(tc) {
      const u = me();
      const cur = checkFresh(db.testcases, tc);
      const { _action, ...clean } = tc;
      const rec = { ...cur, ...clean, updatedAt: nowIso(), updatedBy: u.id, history: [historyEntry(u.id, _action || 'Edited'), ...(cur.history || [])] };
      db.testcases = db.testcases.map((t) => (t.id === rec.id ? rec : t)); persist();
      return delay(rec);
    },
    async createBug(bug) {
      const u = me();
      const at = nowIso();
      const rec = {
        status: 'Open', closedAt: '', closedBy: '', githubIssue: null, ...bug,
        id: nextBugId(db.bugs), reporter: u.id, createdAt: at, updatedAt: at, updatedBy: u.id,
        history: [historyEntry(u.id, 'Reported', bug.assignee ? { assignee: bug.assignee } : {})],
      };
      db.bugs.push(rec);
      if (rec.testCaseId) linkBug(rec.testCaseId, rec.id, u.id);
      persist();
      return delay(rec);
    },
    async updateBug(bug) {
      const u = me();
      const cur = checkFresh(db.bugs, bug);
      const next = { ...cur, ...bug };
      if (next.status === 'Closed' && cur.status !== 'Closed' && !canClose(next, u)) {
        throw new ApiError(403, closeBlockReason(next, db.team));
      }
      const changes = [];
      const extra = { assigneeAtTime: next.assignee };
      if (next.status !== cur.status) { changes.push(`Status: ${cur.status} → ${next.status}`); extra.status = next.status; }
      if (next.assignee !== cur.assignee) {
        const dev = db.team.find((m) => m.id === next.assignee);
        changes.push(next.assignee ? `Assigned to ${dev ? dev.name : next.assignee}` : 'Unassigned');
        if (next.assignee) extra.assignee = next.assignee;
      }
      const at = nowIso();
      const rec = {
        ...next, updatedAt: at, updatedBy: u.id,
        closedAt: next.status === 'Closed' ? (cur.closedAt || at) : '',
        closedBy: next.status === 'Closed' ? (cur.closedBy || u.id) : '',
        history: [historyEntry(u.id, changes.join(' · ') || 'Edited', extra), ...(cur.history || [])],
      };
      db.bugs = db.bugs.map((b) => (b.id === rec.id ? rec : b)); persist();
      return delay(rec);
    },
    async saveTeam(team) {
      const u = me();
      if (u.role !== 'Lead') throw new ApiError(403, 'Only a Lead can change the team.');
      const ids = new Set();
      const nextTeam = team.map((m) => {
        const id = String(m.id).trim().toLowerCase();
        if (!/^[a-z0-9._-]{3,30}$/.test(id)) throw new ApiError(400, `Username "${m.id}" must be 3-30 letters, numbers, dot, dash or underscore.`);
        if (ids.has(id)) throw new ApiError(400, `Username ${id} is used twice.`);
        ids.add(id);
        const old = db.team.find((o) => o.id === id);
        const password = m.newPassword ? m.newPassword : (old?.password || DEFAULT_PASSWORD);
        if (m.newPassword && m.newPassword.length < 8) throw new ApiError(400, 'Passwords need at least 8 characters.');
        return { id, name: m.name.trim(), email: (m.email || '').trim(), role: m.role, github: (m.github || '').replace(/^@/, '').trim(), password };
      });
      if (!nextTeam.some((m) => m.role === 'Lead')) throw new ApiError(400, 'The team needs at least one Lead.');
      db.team = nextTeam; persist();
      return delay(db.team.map(publicMember));
    },
    async saveModules(mods) {
      me();
      for (const m of mods) if (!MODULE_CODE_RE.test(m.code)) throw new ApiError(400, `Module code "${m.code}" must be 2-12 letters/numbers, starting with a letter.`);
      const used = new Set([...db.testcases.map((t) => t.module), ...db.bugs.map((b) => b.module)]);
      for (const old of db.modules) if (!mods.some((m) => m.code === old.code) && used.has(old.code)) throw new ApiError(400, `${old.code} is used by test cases or bugs, so it can't be removed.`);
      db.modules = mods.map((m) => ({ code: m.code, name: m.name.trim() || m.code })); persist();
      return delay(db.modules);
    },
    async importData({ testcases = [], bugs = [], modules = [] }) {
      const u = me();
      for (const m of modules) if (!db.modules.some((x) => x.code === m.code)) db.modules.push(m);
      const at = nowIso();
      for (const t of testcases) {
        const cur = db.testcases.find((x) => x.id === t.id);
        const rec = cur
          ? { ...cur, ...t, bugIds: [...new Set([...(cur.bugIds || []), ...(t.bugIds || [])])], updatedAt: at, updatedBy: u.id, history: [historyEntry(u.id, 'Updated from Excel'), ...(cur.history || [])] }
          : { status: 'Not run', bugIds: [], testedBy: '', testedOn: '', remarks: '', ...t, createdBy: u.id, updatedAt: at, updatedBy: u.id, history: [historyEntry(u.id, 'Imported from Excel')] };
        db.testcases = cur ? db.testcases.map((x) => (x.id === t.id ? rec : x)) : [...db.testcases, rec];
      }
      for (const b of bugs) {
        const cur = db.bugs.find((x) => x.id === b.id);
        const rec = cur
          ? { ...cur, ...b, updatedAt: at, updatedBy: u.id, history: [historyEntry(u.id, 'Updated from Excel', b.assignee && b.assignee !== cur.assignee ? { assignee: b.assignee } : {}), ...(cur.history || [])] }
          : { status: 'Open', closedAt: '', closedBy: '', githubIssue: null, reporter: u.id, createdAt: at, ...b, updatedAt: at, updatedBy: u.id, history: [historyEntry(u.id, 'Imported from Excel', b.assignee ? { assignee: b.assignee } : {})] };
        db.bugs = cur ? db.bugs.map((x) => (x.id === b.id ? rec : x)) : [...db.bugs, rec];
        if (rec.testCaseId && db.testcases.some((t) => t.id === rec.testCaseId)) linkBug(rec.testCaseId, rec.id, u.id);
      }
      persist();
      return delay(view());
    },
    async reset() {
      db = JSON.parse(JSON.stringify(seed)); persist();
      return delay(view());
    },
  };
}

export const api = API_URL ? restApi(API_URL) : demoApi();
