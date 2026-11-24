// Shared rules and helpers. The Java backend enforces the same rules.

export const TC_STATUSES = ['Not run', 'Pass', 'Fail', 'Blocked', 'N/A'];
export const BUG_STATUSES = ['Open', 'In progress', 'Fixed – retest', 'Closed'];
export const PRIORITIES = ['High', 'Medium', 'Low'];
export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
export const ROLES = ['Lead', 'QA', 'Developer'];
export const DONE_STATUSES = ['Fixed – retest', 'Closed'];

/** Only the assigned developer (or a Lead) may close a bug. */
export function canClose(bug, user) {
  if (!user) return false;
  if (user.role === 'Lead') return true;
  return !!bug.assignee && bug.assignee === user.id;
}

export function closeBlockReason(bug, team) {
  if (!bug.assignee) return 'Assign a developer first. Only the assigned developer can close a bug.';
  const dev = team.find((m) => m.id === bug.assignee);
  return `Only ${dev ? dev.name : 'the assigned developer'} can close this bug.`;
}

export function nextBugId(bugs) {
  const max = bugs.reduce((m, b) => Math.max(m, parseInt(String(b.id).replace(/\D/g, ''), 10) || 0), 0);
  return 'BUG-' + String(max + 1).padStart(3, '0');
}

export function nextTestCaseId(testcases, module) {
  const prefix = `TC-${String(module).toUpperCase()}-`;
  const max = testcases
    .filter((t) => t.id.toUpperCase().startsWith(prefix))
    .reduce((m, t) => Math.max(m, parseInt(t.id.slice(prefix.length), 10) || 0), 0);
  return prefix + String(max + 1).padStart(3, '0');
}

export const MODULE_CODE_RE = /^[A-Za-z][A-Za-z0-9]{1,11}$/;

export function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m) return String(iso);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(iso);
}

export function initials(name) {
  return (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

export function memberName(team, id) {
  if (!id) return 'Unassigned';
  if (id === 'import') return 'Excel import';
  const m = team.find((t) => t.id === id);
  return m ? m.name : id;
}

export function matches(obj, q, fields) {
  if (!q) return true;
  const s = q.toLowerCase();
  return fields.some((f) => String(obj[f] || '').toLowerCase().includes(s));
}

/** Stable colour slot (0-7) for a module code, so new modules get their own colour. */
export function moduleSlot(code) {
  const fixed = { WFL: 0, LEV: 1, COMMON: 2 };
  const c = String(code || '').toUpperCase();
  if (c in fixed) return fixed[c];
  let h = 0;
  for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 3 + (h % 5);
}

/** Build a history entry. status/assignee fields let the notification center understand it. */
export function historyEntry(by, action, extra = {}) {
  return { at: nowIso(), by, action, ...extra };
}

/**
 * Notifications for one user, derived from bug history:
 *  - a bug they reported / follow (QA, Lead) was completed (Fixed – retest / Closed) by its developer
 *  - a bug was assigned to them
 *  - a bug assigned to them was closed by someone else
 */
export function notificationsFor(user, bugs, team) {
  if (!user) return [];
  const out = [];
  for (const b of bugs) {
    for (const h of b.history || []) {
      if (h.by === user.id) continue;
      const who = memberName(team, h.by);
      if (h.status && DONE_STATUSES.includes(h.status)) {
        const byAssignee = h.by === (h.assigneeAtTime || b.assignee);
        const follows = b.reporter === user.id || user.role === 'QA' || user.role === 'Lead';
        if (follows && byAssignee) {
          out.push({ key: `${b.id}|${h.at}|done`, at: h.at, bugId: b.id, kind: 'done', text: `${who} completed ${b.id}: moved to ${h.status}`, title: b.title });
        } else if (b.assignee === user.id && h.status === 'Closed') {
          out.push({ key: `${b.id}|${h.at}|closed`, at: h.at, bugId: b.id, kind: 'done', text: `${who} closed ${b.id}`, title: b.title });
        }
      }
      if (h.assignee && h.assignee === user.id) {
        out.push({ key: `${b.id}|${h.at}|assign`, at: h.at, bugId: b.id, kind: 'assign', text: `${who} assigned ${b.id} to you`, title: b.title });
      }
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 50);
}

export const DEFAULT_PASSWORD = 'tester12345';

/** "QA Engineer 1" -> "qa.engineer.1" (the default username for a new member). */
export function usernameFromName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/\.+/g, '.').replace(/^\.|\.$/g, '').slice(0, 30);
}
