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

const publicMember = ({ password, passwordHash, ...m }) => m;

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

function coreApi(S, persist) {
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const me = () => {
    const s = session.get();
    const u = s && S.db.team.find((m) => m.id === s.user?.id);
    if (!u) throw new ApiError(401, 'Please sign in again.');
    return u;
  };
  const view = () => ({ testcases: S.db.testcases, bugs: S.db.bugs, modules: S.db.modules, team: S.db.team.map(publicMember) });
  const delay = (v) => new Promise((r) => setTimeout(() => r(clone(v)), 90));
  const moduleOk = (code) => S.db.modules.some((m) => m.code === code);

  function checkFresh(list, rec) {
    const cur = list.find((x) => x.id === rec.id);
    if (!cur) throw new ApiError(404, `${rec.id} not found`);
    if (rec.updatedAt && cur.updatedAt !== rec.updatedAt) {
      const who = S.db.team.find((m) => m.id === cur.updatedBy);
      throw new ApiError(409, `${rec.id} was changed by ${who ? who.name : cur.updatedBy} meanwhile. Reload and try again.`);
    }
    return cur;
  }

  function linkBug(tcId, bugId, by) {
    S.db.testcases = S.db.testcases.map((t) => (t.id === tcId
      ? { ...t, bugIds: [...new Set([...(t.bugIds || []), bugId])], history: [historyEntry(by, `Linked bug ${bugId}`), ...(t.history || [])] }
      : t));
  }

  return {
    whoami: me,
    async login(login, password) {
      const l = String(login).trim().toLowerCase();
      const u = S.db.team.find((m) => m.id.toLowerCase() === l || (m.email || '').toLowerCase() === l);
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
      u.password = next; await persist('Password changed');
      return delay({ ok: true });
    },
    load: () => { me(); return delay(view()); },
    async createTestCase(tc) {
      const u = me();
      if (S.db.testcases.some((t) => t.id === tc.id)) throw new ApiError(409, `${tc.id} already exists`);
      if (!moduleOk(tc.module)) throw new ApiError(400, `Unknown module ${tc.module}`);
      const at = nowIso();
      const rec = { ...tc, createdBy: u.id, updatedAt: at, updatedBy: u.id, history: [historyEntry(u.id, 'Created')] };
      S.db.testcases.push(rec); await persist(`${rec.id} added by ${u.id}`);
      return delay(rec);
    },
    async updateTestCase(tc) {
      const u = me();
      const cur = checkFresh(S.db.testcases, tc);
      const { _action, ...clean } = tc;
      const rec = { ...cur, ...clean, updatedAt: nowIso(), updatedBy: u.id, history: [historyEntry(u.id, _action || 'Edited'), ...(cur.history || [])] };
      S.db.testcases = S.db.testcases.map((t) => (t.id === rec.id ? rec : t)); await persist(`${rec.id}: ${_action || 'Edited'} (by ${u.id})`);
      return delay(rec);
    },
    async createBug(bug) {
      const u = me();
      const at = nowIso();
      const rec = {
        status: 'Open', closedAt: '', closedBy: '', githubIssue: null, ...bug,
        id: nextBugId(S.db.bugs), reporter: u.id, createdAt: at, updatedAt: at, updatedBy: u.id,
        history: [historyEntry(u.id, 'Reported', bug.assignee ? { assignee: bug.assignee } : {})],
      };
      S.db.bugs.push(rec);
      if (rec.testCaseId) linkBug(rec.testCaseId, rec.id, u.id);
      await persist(`${rec.id} reported by ${u.id}`);
      return delay(rec);
    },
    async updateBug(bug) {
      const u = me();
      const cur = checkFresh(S.db.bugs, bug);
      const next = { ...cur, ...bug };
      if (next.status === 'Closed' && cur.status !== 'Closed' && !canClose(next, u)) {
        throw new ApiError(403, closeBlockReason(next, S.db.team));
      }
      const changes = [];
      const extra = { assigneeAtTime: next.assignee };
      if (next.status !== cur.status) { changes.push(`Status: ${cur.status} → ${next.status}`); extra.status = next.status; }
      if (next.assignee !== cur.assignee) {
        const dev = S.db.team.find((m) => m.id === next.assignee);
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
      S.db.bugs = S.db.bugs.map((b) => (b.id === rec.id ? rec : b)); await persist(`${rec.id}: ${changes.join(' · ') || 'Edited'} (by ${u.id})`);
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
        const old = S.db.team.find((o) => o.id === id);
        const password = m.newPassword ? m.newPassword : (old?.password || DEFAULT_PASSWORD);
        if (m.newPassword && m.newPassword.length < 8) throw new ApiError(400, 'Passwords need at least 8 characters.');
        return { id, name: m.name.trim(), email: (m.email || '').trim(), role: m.role, github: (m.github || '').replace(/^@/, '').trim(), password };
      });
      if (!nextTeam.some((m) => m.role === 'Lead')) throw new ApiError(400, 'The team needs at least one Lead.');
      S.db.team = nextTeam; await persist(`Team updated by ${u.id}`);
      return delay(S.db.team.map(publicMember));
    },
    async saveModules(mods) {
      const u = me();
      for (const m of mods) if (!MODULE_CODE_RE.test(m.code)) throw new ApiError(400, `Module code "${m.code}" must be 2-12 letters/numbers, starting with a letter.`);
      const used = new Set([...S.db.testcases.map((t) => t.module), ...S.db.bugs.map((b) => b.module)]);
      for (const old of S.db.modules) if (!mods.some((m) => m.code === old.code) && used.has(old.code)) throw new ApiError(400, `${old.code} is used by test cases or bugs, so it can't be removed.`);
      S.db.modules = mods.map((m) => ({ code: m.code, name: m.name.trim() || m.code })); await persist(`Modules updated by ${u.id}`);
      return delay(S.db.modules);
    },
    async importData({ testcases = [], bugs = [], modules = [] }) {
      const u = me();
      for (const m of modules) if (!S.db.modules.some((x) => x.code === m.code)) S.db.modules.push(m);
      const at = nowIso();
      for (const t of testcases) {
        const cur = S.db.testcases.find((x) => x.id === t.id);
        const rec = cur
          ? { ...cur, ...t, bugIds: [...new Set([...(cur.bugIds || []), ...(t.bugIds || [])])], updatedAt: at, updatedBy: u.id, history: [historyEntry(u.id, 'Updated from Excel'), ...(cur.history || [])] }
          : { status: 'Not run', bugIds: [], testedBy: '', testedOn: '', remarks: '', ...t, createdBy: u.id, updatedAt: at, updatedBy: u.id, history: [historyEntry(u.id, 'Imported from Excel')] };
        S.db.testcases = cur ? S.db.testcases.map((x) => (x.id === t.id ? rec : x)) : [...S.db.testcases, rec];
      }
      for (const b of bugs) {
        const cur = S.db.bugs.find((x) => x.id === b.id);
        const rec = cur
          ? { ...cur, ...b, updatedAt: at, updatedBy: u.id, history: [historyEntry(u.id, 'Updated from Excel', b.assignee && b.assignee !== cur.assignee ? { assignee: b.assignee } : {}), ...(cur.history || [])] }
          : { status: 'Open', closedAt: '', closedBy: '', githubIssue: null, reporter: u.id, createdAt: at, ...b, updatedAt: at, updatedBy: u.id, history: [historyEntry(u.id, 'Imported from Excel', b.assignee ? { assignee: b.assignee } : {})] };
        S.db.bugs = cur ? S.db.bugs.map((x) => (x.id === b.id ? rec : x)) : [...S.db.bugs, rec];
        if (rec.testCaseId && S.db.testcases.some((t) => t.id === rec.testCaseId)) linkBug(rec.testCaseId, rec.id, u.id);
      }
      await persist(`Excel import by ${u.id}: ${testcases.length} test cases, ${bugs.length} bugs`);
      return delay(view());
    },
    async reset() {
      S.db = JSON.parse(JSON.stringify(seed)); await persist('reset');
      return delay(view());
    },
  };
}

function demoApi() {
  const S = { db: null };
  try { S.db = JSON.parse(safeGet(DEMO_KEY)) || null; } catch { S.db = null; }
  if (!S.db) S.db = JSON.parse(JSON.stringify(seed));
  return { mode: 'demo', label: 'Demo (this browser only)', ...coreApi(S, async () => safeSet(DEMO_KEY, JSON.stringify(S.db))) };
}

// ---------------------------------------------------------------- GitHub (live, no server)
// The website reads and writes the private data repo directly with each person's own
// GitHub token. Every save is one commit, authored by that person. Rules are checked
// here and again by the guard workflow in the data repo.
const GH_TOKEN_KEY = 'mt-gh-token';
const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

function githubApi(repo, branch) {
  const S = { db: null };
  const files = new Map(); // path -> canonical JSON text of what is in the repo
  const blobCache = new Map(); // blob sha -> parsed JSON
  let head = null;

  async function gh(method, path, body, token = safeGet(GH_TOKEN_KEY)) {
    let res;
    try {
      res = await fetch(`https://api.github.com${path}`, {
        method,
        cache: 'no-store',
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, 'Cannot reach GitHub. Check your connection.');
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) {
      if (res.status === 401) throw new ApiError(401, 'GitHub did not accept the token. Create a new one and sign in again.');
      if (res.status === 404) throw new ApiError(403, `No access to ${repo}. Ask your Lead to add your GitHub account, accept the invitation e-mail, and use a token with the "repo" scope.`);
      throw new ApiError(res.status, (data && data.message) || res.statusText);
    }
    return data;
  }

  const pathOf = { testcases: (r) => `data/testcases/${r.id}.json`, bugs: (r) => `data/bugs/${r.id}.json` };
  function snapshot(db) {
    const out = new Map();
    for (const k of ['testcases', 'bugs']) for (const r of db[k]) out.set(pathOf[k](r), JSON.stringify(r));
    out.set('data/modules.json', JSON.stringify(db.modules));
    out.set('data/team.json', JSON.stringify(db.team));
    return out;
  }

  async function sync() {
    const ref = await gh('GET', `/repos/${repo}/git/ref/heads/${branch}`);
    const sha = ref.object.sha;
    if (sha === head && S.db) return;
    const commit = await gh('GET', `/repos/${repo}/git/commits/${sha}`);
    const tree = await gh('GET', `/repos/${repo}/git/trees/${commit.tree.sha}?recursive=1`);
    const blobs = tree.tree.filter((t) => t.type === 'blob' && /^data\/.*\.json$/.test(t.path));
    const todo = blobs.filter((b) => !blobCache.has(b.sha));
    for (let i = 0; i < todo.length; i += 12) {
      await Promise.all(todo.slice(i, i + 12).map(async (b) => {
        const blob = await gh('GET', `/repos/${repo}/git/blobs/${b.sha}`);
        try { blobCache.set(b.sha, JSON.parse(b64decode(blob.content))); } catch { blobCache.set(b.sha, null); }
      }));
    }
    const db = { testcases: [], bugs: [], modules: [], team: [] };
    for (const b of blobs) {
      const v = blobCache.get(b.sha);
      if (v == null) continue;
      if (b.path === 'data/team.json') db.team = v;
      else if (b.path === 'data/modules.json') db.modules = v;
      else if (b.path.startsWith('data/testcases/')) db.testcases.push(v);
      else if (b.path.startsWith('data/bugs/')) db.bugs.push(v);
    }
    db.testcases.sort((a, b) => a.id.localeCompare(b.id));
    db.bugs.sort((a, b) => a.id.localeCompare(b.id));
    S.db = db;
    files.clear();
    for (const [p, t] of snapshot(db)) files.set(p, t);
    head = sha;
  }

  async function persist(message) {
    const changed = [];
    for (const [p, t] of snapshot(S.db)) if (files.get(p) !== t) changed.push({ path: p, mode: '100644', type: 'blob', content: JSON.stringify(JSON.parse(t), null, 2) + '\n' });
    if (!changed.length) return;
    const base = await gh('GET', `/repos/${repo}/git/commits/${head}`);
    const tree = await gh('POST', `/repos/${repo}/git/trees`, { base_tree: base.tree.sha, tree: changed });
    const commit = await gh('POST', `/repos/${repo}/git/commits`, { message: `tracker: ${message}`, tree: tree.sha, parents: [head] });
    try {
      await gh('PATCH', `/repos/${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: false });
    } catch (e) {
      head = null; // someone else saved in between: reload before the next try
      if (e.status === 422 || e.status === 409) throw new ApiError(409, 'Someone else saved at the same moment. The page has been refreshed, please try again.');
      throw e;
    }
    head = commit.sha;
    for (const c of changed) files.set(c.path, JSON.stringify(JSON.parse(c.content)));
  }

  const core = coreApi(S, persist);
  // Every write starts from the latest repo state, so "changed meanwhile" checks are real.
  const fresh = (fn) => async (...args) => {
    await sync();
    try { return await fn(...args); } catch (e) { if (e.status === 409) head = null; throw e; }
  };

  return {
    ...core,
    mode: 'live',
    kind: 'github',
    label: `GitHub repository ${repo} (live)`,
    async login(login, token) {
      token = String(token).trim();
      const gu = await gh('GET', '/user', null, token);
      const info = await gh('GET', `/repos/${repo}`, null, token);
      if (!info.permissions?.push) throw new ApiError(403, `Your GitHub account @${gu.login} can read but not save to ${repo}. Ask your Lead for write access.`);
      safeSet(GH_TOKEN_KEY, token);
      head = null;
      await sync();
      const l = String(login).trim().toLowerCase();
      const ghl = gu.login.toLowerCase();
      let u = S.db.team.find((m) => m.id.toLowerCase() === l || (m.email || '').toLowerCase() === l);
      if (!u && !l) u = S.db.team.find((m) => (m.github || '').toLowerCase() === ghl);
      if (!u) { safeSet(GH_TOKEN_KEY, null); throw new ApiError(401, 'That username is not in the team. Ask your Lead to add you.'); }
      if (u.github && u.github.toLowerCase() !== ghl) {
        safeSet(GH_TOKEN_KEY, null);
        throw new ApiError(401, `${u.id} is linked to GitHub @${u.github}, but this token belongs to @${gu.login}.`);
      }
      if (!u.github) {
        // First sign-in: only the repo owner/admin may link a member to their own GitHub account.
        if (!info.permissions?.admin) { safeSet(GH_TOKEN_KEY, null); throw new ApiError(401, `Ask your Lead to put your GitHub username (@${gu.login}) on your Team entry first.`); }
        u.github = gu.login;
        await persist(`${u.id} linked to GitHub @${gu.login}`);
      }
      const user = publicMember(u);
      session.set({ token: 'github', user });
      return user;
    },
    me: fresh(core.me),
    logout() { session.set(null); safeSet(GH_TOKEN_KEY, null); },
    changePassword: async () => { throw new ApiError(400, 'Sign-in uses your GitHub token, so there is no tracker password to change.'); },
    async load() { await sync(); return core.load(); },
    createTestCase: fresh(core.createTestCase),
    updateTestCase: fresh(core.updateTestCase),
    createBug: fresh(core.createBug),
    updateBug: fresh(core.updateBug),
    saveModules: fresh(core.saveModules),
    importData: fresh(core.importData),
    saveTeam: fresh(async (team) => {
      const u = core.whoami();
      if (u.role !== 'Lead') throw new ApiError(403, 'Only a Lead can change the team.');
      const before = new Set(S.db.team.map((m) => (m.github || '').toLowerCase()).filter(Boolean));
      const old = new Map(S.db.team.map((m) => [m.id, m]));
      const ids = new Set();
      const next = team.map((m) => {
        const id = String(m.id).trim().toLowerCase();
        if (!/^[a-z0-9._-]{3,30}$/.test(id)) throw new ApiError(400, `Username "${m.id}" must be 3-30 letters, numbers, dot, dash or underscore.`);
        if (ids.has(id)) throw new ApiError(400, `Username ${id} is used twice.`);
        ids.add(id);
        const { password, newPassword, originalId, ...prev } = { ...(old.get(id) || {}) };
        return { ...prev, id, name: String(m.name || '').trim(), email: (m.email || '').trim(), role: m.role, github: (m.github || '').replace(/^@/, '').trim() };
      });
      if (!next.some((m) => m.role === 'Lead')) throw new ApiError(400, 'The team needs at least one Lead.');
      S.db.team = next;
      await persist(`Team updated by ${u.id}`);
      const failed = [];
      for (const m of next) {
        if (!m.github || before.has(m.github.toLowerCase())) continue;
        try { await gh('PUT', `/repos/${repo}/collaborators/${encodeURIComponent(m.github)}`, { permission: 'push' }); }
        catch (e) { failed.push(`@${m.github} (${e.message})`); }
      }
      if (failed.length) throw new ApiError(409, `Team saved, but GitHub could not invite ${failed.join(', ')}. Invite them in the data repo's Settings > Collaborators.`);
      return next.map(publicMember);
    }),
    reset: null,
  };
}

const DATA_REPO = import.meta.env.VITE_DATA_REPO || '';
export const api = DATA_REPO
  ? githubApi(DATA_REPO, import.meta.env.VITE_DATA_BRANCH || 'main')
  : API_URL ? restApi(API_URL) : demoApi();
