// Turns Excel sheets into test cases and bugs, and checks them before anything is saved.
import { excelDateToIso } from './xlsx.js';
import { MODULE_CODE_RE, PRIORITIES, SEVERITIES } from './rules.js';

const TC_COLS = {
  id: ['tc id', 'test case id', 'testcase id', 'tc no', 'id'],
  module: ['module'], screen: ['screen', 'screen id'], scenario: ['scenario', 'test scenario', 'test case', 'title'],
  loginAs: ['login as', 'role', 'user role'], precondition: ['pre-condition', 'precondition', 'pre condition', 'preconditions'],
  steps: ['steps', 'test steps'], expected: ['expected result', 'expected', 'expected results'], priority: ['priority'],
  specRef: ['spec ref', 'spec', 'reference'], status: ['status', 'result'], bugId: ['bug id', 'bug ids', 'bug'],
  testedBy: ['tested by', 'tester'], testedOn: ['date', 'tested on', 'test date'], remarks: ['remarks', 'comments', 'comment'],
};
const BUG_COLS = {
  id: ['bug id', 'id', 'defect id'], module: ['module'], title: ['title', 'summary', 'bug title'], status: ['status'],
  severity: ['severity'], assignee: ['assigned to', 'assignee', 'developer'], reportedOn: ['reported on', 'reported date', 'created on', 'date'],
  steps: ['steps to reproduce', 'steps'], expected: ['expected result', 'expected'], actual: ['actual result', 'actual'],
  fixedOn: ['fixed on', 'fixed date'], notes: ['notes', 'remarks', 'comments'], testCaseId: ['test case', 'tc id', 'test case id', 'linked test case'],
};

const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const text = (v) => (v == null ? '' : String(v).trim());

function findHeader(rows, mustHave) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map(norm);
    if (mustHave.every((names) => names.some((n) => cells.includes(n)))) return i;
  }
  return -1;
}

function mapColumns(header, spec) {
  const cells = header.map(norm);
  const map = {};
  for (const [key, names] of Object.entries(spec)) {
    const idx = names.map((n) => cells.indexOf(n)).find((i) => i >= 0);
    if (idx !== undefined) map[key] = idx;
  }
  return map;
}

function asDate(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return excelDateToIso(v);
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

const TC_STATUS = { 'not run': 'Not run', notrun: 'Not run', '': 'Not run', pass: 'Pass', passed: 'Pass', fail: 'Fail', failed: 'Fail', blocked: 'Blocked', 'n/a': 'N/A', na: 'N/A', 'not applicable': 'N/A' };
const BUG_STATUS = { open: 'Open', new: 'Open', reopened: 'Open', 'in progress': 'In progress', 'in-progress': 'In progress', fixed: 'Fixed – retest', retest: 'Fixed – retest', 'fixed – retest': 'Fixed – retest', 'fixed - retest': 'Fixed – retest', 'ready for retest': 'Fixed – retest', closed: 'Closed', done: 'Closed', '': 'Open' };

/**
 * @returns {{ testcases, bugs, modulesToCreate, issues, stats, sheetsUsed }}
 *   issues: [{ level: 'error'|'warn', sheet, row, text }]
 */
export function analyse(sheets, data, { onExisting = 'update' } = {}) {
  const issues = [];
  const add = (level, sheet, row, t) => issues.push({ level, sheet, row, text: t });
  const modules = [...data.modules];
  const modulesToCreate = [];
  const sheetsUsed = [];

  const resolveModule = (raw, sheet, row) => {
    const v = text(raw);
    if (!v) { add('error', sheet, row, 'Module is empty.'); return null; }
    const hit = modules.find((m) => m.code.toLowerCase() === v.toLowerCase() || m.name.toLowerCase() === v.toLowerCase());
    if (hit) return hit.code;
    const code = v.replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
    if (!MODULE_CODE_RE.test(code)) { add('error', sheet, row, `Module "${v}" is not a valid module code.`); return null; }
    const created = { code, name: v };
    modules.push(created);
    modulesToCreate.push(created);
    add('warn', sheet, row, `New module "${code}" will be created.`);
    return code;
  };

  const findMember = (raw) => {
    const v = norm(raw);
    if (!v) return null;
    return data.team.find((m) => [m.id, m.name, m.email, m.github].some((x) => norm(x) === v)) || null;
  };

  const testcases = [];
  const bugs = [];
  const tcIds = new Set();
  const bugIds = new Set();
  const stats = { tcNew: 0, tcUpdate: 0, tcSkip: 0, bugNew: 0, bugUpdate: 0, bugSkip: 0, invalid: 0 };

  for (const sh of sheets) {
    const tcHead = findHeader(sh.rows, [['scenario', 'test scenario', 'test case'], ['tc id', 'test case id', 'testcase id', 'id']]);
    const bugHead = findHeader(sh.rows, [['title', 'summary', 'bug title'], ['bug id', 'defect id']]);
    if (tcHead >= 0 && bugHead < 0) {
      sheetsUsed.push(`${sh.name} (test cases)`);
      const col = mapColumns(sh.rows[tcHead], TC_COLS);
      for (let i = tcHead + 1; i < sh.rows.length; i++) {
        const r = sh.rows[i] || [];
        const get = (k) => (col[k] === undefined ? '' : r[col[k]]);
        if (r.every((c) => c == null || c === '')) continue;
        const rowNo = i + 1;
        const scenario = text(get('scenario'));
        if (!scenario) { add('error', sh.name, rowNo, 'Scenario is empty, row skipped.'); stats.invalid++; continue; }
        const module = resolveModule(get('module'), sh.name, rowNo);
        if (!module) { stats.invalid++; continue; }
        let id = text(get('id')).toUpperCase();
        if (!id) { add('error', sh.name, rowNo, 'TC ID is empty, row skipped.'); stats.invalid++; continue; }
        if (tcIds.has(id)) { add('error', sh.name, rowNo, `${id} appears twice in the file; second one skipped.`); stats.invalid++; continue; }
        tcIds.add(id);
        const rawStatus = norm(get('status'));
        const status = TC_STATUS[rawStatus];
        if (!status) add('warn', sh.name, rowNo, `${id}: status "${get('status')}" not recognised, set to Not run.`);
        let priority = PRIORITIES.find((p) => p.toLowerCase() === norm(get('priority'))) || 'Medium';
        if (get('priority') && !PRIORITIES.some((p) => p.toLowerCase() === norm(get('priority')))) add('warn', sh.name, rowNo, `${id}: priority "${get('priority')}" set to Medium.`);
        const testerRaw = text(get('testedBy'));
        const tester = findMember(testerRaw);
        if (testerRaw && !tester) add('warn', sh.name, rowNo, `${id}: tester "${testerRaw}" is not in the team; kept as text.`);
        const linked = text(get('bugId')).split(/[,;\s]+/).filter(Boolean).map((x) => x.toUpperCase());
        const exists = data.testcases.some((t) => t.id === id);
        if (exists && onExisting === 'skip') { stats.tcSkip++; continue; }
        exists ? stats.tcUpdate++ : stats.tcNew++;
        testcases.push({
          id, module, screen: text(get('screen')), scenario, loginAs: text(get('loginAs')), precondition: text(get('precondition')),
          steps: text(get('steps')), expected: text(get('expected')), priority, specRef: text(get('specRef')),
          status: status || 'Not run', testedBy: tester ? tester.id : testerRaw, testedOn: asDate(get('testedOn')),
          remarks: text(get('remarks')), bugIds: linked,
        });
      }
    } else if (bugHead >= 0) {
      sheetsUsed.push(`${sh.name} (bugs)`);
      const col = mapColumns(sh.rows[bugHead], BUG_COLS);
      for (let i = bugHead + 1; i < sh.rows.length; i++) {
        const r = sh.rows[i] || [];
        const get = (k) => (col[k] === undefined ? '' : r[col[k]]);
        if (r.every((c) => c == null || c === '')) continue;
        const rowNo = i + 1;
        const title = text(get('title'));
        if (!title) { add('error', sh.name, rowNo, 'Title is empty, row skipped.'); stats.invalid++; continue; }
        const module = resolveModule(get('module'), sh.name, rowNo);
        if (!module) { stats.invalid++; continue; }
        let id = text(get('id')).toUpperCase();
        if (id && !/^BUG-\d+$/.test(id)) { add('warn', sh.name, rowNo, `Bug ID "${id}" doesn't look like BUG-001; a new ID will be given.`); id = ''; }
        if (id && bugIds.has(id)) { add('error', sh.name, rowNo, `${id} appears twice in the file; second one skipped.`); stats.invalid++; continue; }
        const sev = SEVERITIES.find((s) => s.toLowerCase() === norm(get('severity')));
        if (!sev) add('warn', sh.name, rowNo, `${id || title.slice(0, 30)}: severity "${get('severity')}" set to Medium.`);
        const st = BUG_STATUS[norm(get('status'))];
        if (!st) add('warn', sh.name, rowNo, `${id || title.slice(0, 30)}: status "${get('status')}" set to Open.`);
        const asRaw = text(get('assignee'));
        const dev = findMember(asRaw);
        let assignee = '';
        if (asRaw && !dev) add('warn', sh.name, rowNo, `${id || title.slice(0, 30)}: "${asRaw}" is not in the team, left unassigned.`);
        else if (dev && dev.role !== 'Developer') add('warn', sh.name, rowNo, `${id || title.slice(0, 30)}: ${dev.name} is not a Developer, left unassigned.`);
        else if (dev) assignee = dev.id;
        const exists = id && data.bugs.some((b) => b.id === id);
        if (exists && onExisting === 'skip') { stats.bugSkip++; continue; }
        if (id) bugIds.add(id);
        exists ? stats.bugUpdate++ : stats.bugNew++;
        const reported = asDate(get('reportedOn'));
        const tcId = text(get('testCaseId')).toUpperCase();
        bugs.push({
          id, title, module, severity: sev || 'Medium', status: st || 'Open', assignee,
          steps: text(get('steps')), expected: text(get('expected')), actual: text(get('actual')), notes: text(get('notes')),
          testCaseId: tcId, ...(reported && !exists ? { createdAt: `${reported}T00:00:00Z` } : {}),
          ...(st === 'Closed' ? { closedAt: asDate(get('fixedOn')) ? `${asDate(get('fixedOn'))}T00:00:00Z` : '' } : {}),
        });
      }
    }
  }

  // Give IDs to new bugs without one, after the highest existing number.
  let max = [...data.bugs.map((b) => b.id), ...bugIds].reduce((m, x) => Math.max(m, parseInt(String(x).replace(/\D/g, ''), 10) || 0), 0);
  for (const b of bugs) if (!b.id) b.id = 'BUG-' + String(++max).padStart(3, '0');

  // Test case ↔ bug links: from the TC sheet's "Bug ID" column too.
  for (const t of testcases) {
    for (const bid of t.bugIds) {
      const b = bugs.find((x) => x.id === bid);
      if (b && !b.testCaseId) b.testCaseId = t.id;
      if (!b && !data.bugs.some((x) => x.id === bid)) add('warn', 'Test cases', null, `${t.id} refers to ${bid}, which is not in the tracker or the file.`);
    }
  }
  for (const b of bugs) {
    if (b.testCaseId && !testcases.some((t) => t.id === b.testCaseId) && !data.testcases.some((t) => t.id === b.testCaseId)) {
      add('warn', 'Bugs', null, `${b.id} links to ${b.testCaseId}, which doesn't exist; link removed.`);
      b.testCaseId = '';
    }
  }

  if (sheetsUsed.length === 0) add('error', '', null, 'No test case or bug sheet found. The header row needs "TC ID" + "Scenario" (test cases) or "Bug ID" + "Title" (bugs).');
  return { testcases, bugs, modulesToCreate, issues, stats, sheetsUsed };
}
