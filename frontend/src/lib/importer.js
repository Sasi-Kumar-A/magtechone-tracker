// Reads any test case / bug sheet (xlsx or csv), works out which column is which, and decides
// per row: new, already in the tracker (same content), or unreadable.
//  - IDs in the file are NOT used to decide "already exists" (testers number from 1, 01, 0001…).
//    The content (module + scenario + steps + expected) decides. New rows get tracker IDs;
//    the tester's own ID is kept as sourceId.
//  - A row whose result is FAIL also becomes a bug (unless that bug is already in the tracker),
//    linked to the test case. So one sheet with Pass/Fail results is enough.
import { excelDateToIso } from './xlsx.js';
import { MODULE_CODE_RE, PRIORITIES, SEVERITIES, nextTestCaseId } from './rules.js';

// ------------------------------------------------------------------ column detection
// Each field lists header names people use. Matching ignores case, spaces and punctuation.
const FIELDS = {
  tcId: ['test case id', 'testcase id', 'tc id', 'tc no', 'tc number', 'test id', 'case id', 'test case no', 'sl no', 's no', 'sno', 'serial no', 'id', 'no'],
  bugId: ['bug id', 'defect id', 'bug no', 'defect no', 'issue id', 'bug number', 'bug #', 'bug', 'defect'],
  module: ['module', 'module name', 'feature', 'area', 'component', 'functionality', 'application'],
  sheetRef: ['sheet'],
  screen: ['screen name', 'screen', 'screen id', 'page', 'page name', 'menu', 'form'],
  testType: ['test type', 'type', 'testing type', 'category'],
  scenario: ['test scenario steps', 'test scenario', 'scenario', 'test case', 'test case name', 'test case title', 'test case description', 'test description', 'description', 'test objective', 'objective', 'requirement', 'title', 'summary', 'bug title', 'defect title', 'issue', 'bug description', 'defect description'],
  loginAs: ['login as', 'logged in as', 'user role', 'role', 'user type', 'actor'],
  precondition: ['pre condition', 'precondition', 'pre conditions', 'preconditions', 'prerequisite', 'prerequisites', 'pre requisite'],
  steps: ['test steps', 'steps', 'steps to reproduce', 'steps to execute', 'procedure', 'test procedure', 'how to test', 'repro steps'],
  inputData: ['input data', 'test data', 'input', 'data'],
  expected: ['expected result', 'expected results', 'expected', 'expected output', 'expected behaviour', 'expected behavior'],
  actual: ['actual result', 'actual results', 'actual', 'actual output', 'actual behaviour', 'actual behavior', 'observed', 'observation'],
  status: ['status', 'result', 'test result', 'execution status', 'test status', 'pass fail', 'pass/fail', 'outcome', 'verdict'],
  bugStatus: ['bug status', 'defect status', 'issue status', 'fix status'],
  priority: ['priority', 'test priority'],
  severity: ['severity', 'bug severity', 'defect severity', 'impact'],
  testedBy: ['tested by', 'tester', 'executed by', 'tester name', 'qa', 'run by', 'reported by', 'reporter', 'raised by'],
  testedOn: ['test date', 'tested on', 'execution date', 'date', 'run date', 'executed on', 'reported on', 'reported date', 'created on', 'raised on'],
  browser: ['browser device', 'browser', 'device', 'environment', 'platform', 'os'],
  notesDefect: ['notes defect id', 'linked bug', 'linked defect', 'bug ref', 'defect ref', 'bug ids'],
  assignee: ['assigned to developer', 'assigned to', 'assignee', 'developer', 'owner', 'fixed by', 'dev'],
  retestDate: ['retest date', 're test date'],
  retestResult: ['retest result', 're test result', 'retest status'],
  remarks: ['remark', 'remarks', 'notes', 'note', 'comments', 'comment', 'observations'],
  specRef: ['spec ref', 'spec', 'reference', 'requirement id', 'req id', 'user story'],
  tcLink: ['test case id link', 'linked test case', 'related test case'],
};
const key = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();
const text = (v) => (v == null ? '' : String(v).trim());
const words = (s) => ` ${s} `;

function scoreHeader(cell, names) {
  const h = key(cell);
  if (!h) return 0;
  let best = 0;
  for (const n of names) {
    const k = key(n);
    if (h === k) return 100 + k.length;
    if (words(h).includes(words(k))) best = Math.max(best, 10 + k.length);
  }
  return best;
}

/** Best one-to-one assignment of columns to fields. Returns { field: columnIndex }. */
function mapColumns(header) {
  const cand = [];
  header.forEach((cell, col) => {
    for (const [field, names] of Object.entries(FIELDS)) {
      const s = scoreHeader(cell, names);
      if (s) cand.push({ field, col, s });
    }
  });
  cand.sort((a, b) => b.s - a.s);
  const map = {};
  const used = new Set();
  for (const c of cand) {
    if (map[c.field] !== undefined || used.has(c.col)) continue;
    map[c.field] = c.col;
    used.add(c.col);
  }
  return map;
}

function findHeaderRow(rows) {
  let best = { row: -1, n: 0, map: {} };
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i] || [];
    if (r.filter((c) => text(c)).length < 2) continue;
    const map = mapColumns(r);
    const n = Object.keys(map).length;
    const hasText = map.scenario !== undefined || map.steps !== undefined || map.expected !== undefined;
    if (hasText && n > best.n) best = { row: i, n, map };
  }
  return best.n >= 2 ? best : null;
}

// ------------------------------------------------------------------ value helpers
function asDate(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return v > 20000 && v < 80000 ? excelDateToIso(v) : '';
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/); // dd/mm/yyyy (used in India)
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

function tcStatus(v) {
  const s = key(v);
  if (!s) return 'Not run';
  if (/^(pass|passed|ok|success|successful|working|done|yes|y)$/.test(s) || s.startsWith('pass')) return 'Pass';
  if (/^(fail|failed|failure|not working|no|n|ko|bug|defect)$/.test(s) || s.startsWith('fail')) return 'Fail';
  if (s.startsWith('block') || s === 'hold' || s === 'on hold') return 'Blocked';
  if (/^(n a|na|not applicable|skip|skipped)$/.test(s)) return 'N/A';
  if (/^(not run|not executed|pending|to do|todo|not tested|no run)$/.test(s)) return 'Not run';
  return null;
}
function bugStatus(v) {
  const s = key(v);
  if (!s) return 'Open';
  if (/close|done|resolved|verified/.test(s)) return 'Closed';
  if (/retest|fixed|ready/.test(s)) return 'Fixed – retest';
  if (/progress|working|assigned|dev/.test(s)) return 'In progress';
  if (/reject|invalid|duplicate|not a bug/.test(s)) return 'Closed';
  return 'Open';
}
const pickFrom = (list, v, fallback) => list.find((x) => x.toLowerCase() === key(v)) || fallback;
const firstLine = (s) => String(s || '').split(/\r?\n/)[0].trim();

/** Same text = same record, whatever the ID, spacing, case or punctuation. */
export const contentKey = (...parts) => parts.map((p) => key(p)).join('|');
const tcKey = (t) => contentKey(t.module, t.scenario, t.steps, t.expected);
const bugKey = (b) => contentKey(b.module, firstLine(b.title), b.actual);

// ------------------------------------------------------------------ main
/**
 * @param sheets [{ name, rows }]
 * @param data   tracker data (testcases, bugs, modules, team)
 * @param opts   { onExisting: 'skip'|'update', defaultModule, bugsFromFails: true }
 */
export function analyse(sheets, data, { onExisting = 'skip', defaultModule = '', bugsFromFails = true } = {}) {
  const issues = [];
  const note = (level, sheet, row, t) => issues.push({ level, sheet, row, text: t });
  const modules = [...data.modules];
  const modulesToCreate = [];
  const sheetsUsed = [];

  const moduleByText = (v) => {
    const k = key(v);
    if (!k) return null;
    return modules.find((m) => key(m.code) === k || key(m.name) === k) || null;
  };
  // "LEV Admin" → LEV; "ATT Employee" → ATT (created if it looks like a code)
  const moduleFromSheet = (name) => {
    const hit = moduleByText(name);
    if (hit) return hit.code;
    const first = String(name || '').trim().split(/[\s_-]+/)[0] || '';
    const byFirst = moduleByText(first);
    if (byFirst) return byFirst.code;
    if (/^[A-Z][A-Z0-9]{1,5}$/.test(first) && MODULE_CODE_RE.test(first)) {
      const created = { code: first, name: first };
      modules.push(created); modulesToCreate.push(created);
      return first;
    }
    return null;
  };

  // Same person can be in the team twice (e.g. as QA and as Developer): prefer the wanted role.
  const findMember = (raw, prefer = []) => {
    const k = key(raw);
    if (!k) return null;
    const exact = data.team.filter((m) => [m.id, m.name, m.email, m.github].some((x) => key(x) === k));
    const loose = data.team.filter((m) => key(m.name).split(' ').includes(k) || key(m.name).startsWith(k) || key(m.id).split(/[ .]/).includes(k));
    const all = [...exact, ...loose.filter((m) => !exact.includes(m))];
    if (!all.length) return null;
    return all.find((m) => prefer.includes(m.role)) || exact[0] || (new Set(all.map((m) => m.name)).size === 1 ? all[0] : null);
  };

  const existingTc = new Map(data.testcases.map((t) => [tcKey(t), t]));
  const existingBug = new Map(data.bugs.map((b) => [bugKey(b), b]));
  const fileTc = new Map();
  const fileBug = new Map();
  const allTcs = [...data.testcases];
  const testcases = []; // records to save (new or updated)
  const bugs = [];
  const skipped = []; // { sheet, row, text, reason }
  const stats = { tcNew: 0, tcUpdate: 0, tcSkip: 0, bugNew: 0, bugUpdate: 0, bugSkip: 0, invalid: 0, bugsFromFails: 0 };
  const sourceToNew = new Map(); // "<sheet>|<tester id>" and "<tester id>" → tracker test case id
  let bugMax = data.bugs.reduce((m, b) => Math.max(m, parseInt(String(b.id).replace(/\D/g, ''), 10) || 0), 0);
  const newBugId = () => 'BUG-' + String(++bugMax).padStart(3, '0');
  const mappings = [];

  const addBug = (b, sheet, row, from) => {
    const k = bugKey(b);
    const have = existingBug.get(k);
    if (have) {
      if (onExisting === 'update') {
        bugs.push({ ...b, id: have.id, testCaseId: b.testCaseId || have.testCaseId || '' });
        stats.bugUpdate++;
      } else {
        stats.bugSkip++;
        skipped.push({ sheet, row, text: firstLine(b.title), reason: `already in the tracker as ${have.id}` });
      }
      return have.id;
    }
    const dup = fileBug.get(k);
    if (dup) {
      if (!dup.testCaseId && b.testCaseId) dup.testCaseId = b.testCaseId;
      if (from === 'sheet' && b.assignee && !dup.assignee) dup.assignee = b.assignee;
      return dup.id; // same bug from the test sheet (FAIL) and the bug sheet: keep one
    }
    const rec = { ...b, id: newBugId(), _new: true };
    fileBug.set(k, rec); bugs.push(rec); stats.bugNew++;
    if (from === 'fail') stats.bugsFromFails++;
    return rec.id;
  };

  const assigneeFor = (raw, sheet, row, label) => {
    const v = text(raw);
    if (!v) return '';
    const dev = findMember(v, ['Developer']);
    if (!dev) { note('warn', sheet, row, `${label}: "${v}" is not in the team, left unassigned.`); return ''; }
    if (dev.role !== 'Developer') { note('warn', sheet, row, `${label}: ${dev.name} is not a Developer, left unassigned.`); return ''; }
    return dev.id;
  };

  const sheetQueue = [];
  for (const sh of sheets) {
    const head = findHeaderRow(sh.rows);
    if (!head) continue;
    const m = head.map;
    const bugScore = ['bugId', 'severity', 'bugStatus', 'actual', 'assignee'].filter((f) => m[f] !== undefined).length + (m.bugId !== undefined && m.status === undefined ? 2 : 0);
    const tcScore = ['tcId', 'status', 'steps', 'expected', 'precondition', 'testedBy', 'priority'].filter((f) => m[f] !== undefined).length;
    const kind = m.bugId !== undefined && m.status === undefined && bugScore >= tcScore ? 'bugs' : 'tests';
    sheetQueue.push({ sh, head, kind });
  }
  // test sheets first, so bug sheets can link to the new test case IDs
  sheetQueue.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'tests' ? -1 : 1));

  for (const { sh, head, kind } of sheetQueue) {
    const col = head.map;
    const header = sh.rows[head.row];
    mappings.push({ sheet: sh.name, kind, headerRow: head.row + 1, columns: Object.entries(col).sort((a, b) => a[1] - b[1]).map(([f, c]) => ({ from: text(header[c]), to: f })) });
    sheetsUsed.push(`${sh.name} (${kind === 'tests' ? 'test cases' : 'bugs'})`);
    const sheetModule = moduleFromSheet(sh.name);

    for (let i = head.row + 1; i < sh.rows.length; i++) {
      const r = sh.rows[i] || [];
      const get = (f) => (col[f] === undefined ? '' : text(r[col[f]]));
      const filled = r.filter((c) => text(c)).length;
      if (!filled) continue;
      const rowNo = i + 1;
      const scenario = get('scenario') || firstLine(get('steps'));
      const steps = get('scenario') ? get('steps') : get('steps').split(/\r?\n/).slice(1).join('\n');
      if (!scenario) {
        if (filled > 1) { stats.invalid++; skipped.push({ sheet: sh.name, row: rowNo, text: r.filter((c) => text(c)).slice(0, 3).join(' · '), reason: kind === 'tests' ? 'no scenario / description text' : 'no title / description text' }); }
        continue;
      }
      const modCell = get('module');
      const mod = moduleByText(modCell)?.code || moduleFromSheet(get('sheetRef')) || sheetModule || defaultModule || modules[0]?.code;
      if (!mod) { stats.invalid++; skipped.push({ sheet: sh.name, row: rowNo, text: scenario, reason: 'no module (choose a default module above)' }); continue; }
      const submodule = modCell && !moduleByText(modCell) ? modCell : '';

      if (kind === 'tests') {
        const rawSt = get('status');
        let status = tcStatus(rawSt);
        if (!status) { note('warn', sh.name, rowNo, `Result "${rawSt}" not recognised, set to Not run.`); status = 'Not run'; }
        const testerRaw = get('testedBy');
        const tester = findMember(testerRaw, ['QA', 'Lead']);
        const sourceId = get('tcId');
        const rec = {
          module: mod, screen: get('screen'), scenario, steps, expected: get('expected'), actual: get('actual'),
          precondition: get('precondition'), loginAs: get('loginAs'), inputData: get('inputData'), testType: get('testType'),
          priority: pickFrom(PRIORITIES, get('priority'), get('priority') && key(get('priority')) === 'critical' ? 'High' : 'Medium'),
          specRef: get('specRef'), status, testedBy: tester ? tester.id : testerRaw, testedOn: asDate(get('testedOn')),
          browser: get('browser'), remarks: get('remarks'), ...(submodule ? { submodule } : {}), ...(sourceId ? { sourceId } : {}),
        };
        const k = tcKey(rec);
        let id;
        const have = existingTc.get(k);
        if (have) {
          id = have.id;
          if (onExisting === 'update') {
            const upd = { id };
            for (const [f, v] of Object.entries(rec)) if (v && !(f === 'status' && v === 'Not run')) upd[f] = v;
            testcases.push(upd); stats.tcUpdate++;
          } else {
            stats.tcSkip++;
            skipped.push({ sheet: sh.name, row: rowNo, text: scenario, reason: `already in the tracker as ${have.id}` });
          }
        } else if (fileTc.has(k)) {
          id = fileTc.get(k).id;
          skipped.push({ sheet: sh.name, row: rowNo, text: scenario, reason: `same as row ${fileTc.get(k)._row} in this file` });
          stats.invalid++;
        } else {
          id = nextTestCaseId(allTcs, mod);
          const t = { ...rec, id, bugIds: [], _new: true, _row: rowNo };
          allTcs.push(t); fileTc.set(k, t); testcases.push(t); stats.tcNew++;
        }
        if (sourceId) { sourceToNew.set(`${key(sh.name)}|${key(sourceId)}`, id); if (!sourceToNew.has(key(sourceId))) sourceToNew.set(key(sourceId), id); }

        if (status === 'Fail' && bugsFromFails) {
          const sev = pickFrom(SEVERITIES, get('severity'), pickFrom(SEVERITIES, get('priority'), 'Medium'));
          addBug({
            title: scenario, module: mod, severity: sev, status: bugStatus(get('bugStatus')),
            assignee: assigneeFor(get('assignee'), sh.name, rowNo, scenario.slice(0, 30)),
            steps: [rec.precondition && `Pre-condition: ${rec.precondition}`, steps || scenario].filter(Boolean).join('\n'),
            expected: rec.expected, actual: rec.actual || rec.remarks, notes: [get('notesDefect') && `Tester's bug ref: ${get('notesDefect')}`, rec.remarks].filter(Boolean).join('\n'),
            testCaseId: id, ...(rec.testedOn ? { createdAt: `${rec.testedOn}T00:00:00Z` } : {}),
          }, sh.name, rowNo, 'fail');
        }
      } else {
        const tcRef = get('tcLink') || get('tcId');
        const linked = tcRef ? (sourceToNew.get(`${key(get('sheetRef'))}|${key(tcRef)}`) || sourceToNew.get(key(tcRef)) || data.testcases.find((t) => key(t.id) === key(tcRef))?.id || '') : '';
        const st = bugStatus(get('bugStatus') || get('status'));
        const reported = asDate(get('testedOn'));
        addBug({
          title: scenario, module: mod, severity: pickFrom(SEVERITIES, get('severity'), pickFrom(SEVERITIES, get('priority'), 'Medium')), status: st,
          assignee: assigneeFor(get('assignee'), sh.name, rowNo, scenario.slice(0, 30)),
          steps, expected: get('expected'), actual: get('actual'),
          notes: [get('bugId') && `Tester's bug ID: ${get('bugId')}`, get('remarks'), get('retestResult') && `Retest: ${get('retestResult')}`].filter(Boolean).join('\n'),
          testCaseId: linked, ...(reported ? { createdAt: `${reported}T00:00:00Z` } : {}),
        }, sh.name, rowNo, 'sheet');
      }
    }
  }

  for (const t of testcases) { delete t._row; }
  if (!sheetQueue.length) note('error', '', null, 'No test case or bug table found. The sheet needs a header row with at least a description column (e.g. "Scenario", "Test case", "Title", "Steps") and one more column such as "Expected result", "Status" or "Bug ID".');
  return { testcases, bugs, modulesToCreate, issues, stats, sheetsUsed, skipped, mappings };
}

/** Friendly names for the detected-columns preview. */
export const FIELD_LABELS = {
  tcId: "Tester's test case ID", bugId: "Tester's bug ID", module: 'Module', sheetRef: 'Sheet', screen: 'Screen', testType: 'Test type',
  scenario: 'Scenario / title', loginAs: 'Login as', precondition: 'Pre-condition', steps: 'Steps', inputData: 'Input data',
  expected: 'Expected result', actual: 'Actual result', status: 'Result (Pass/Fail)', bugStatus: 'Bug status', priority: 'Priority',
  severity: 'Severity', testedBy: 'Tested by', testedOn: 'Date', browser: 'Browser / device', notesDefect: 'Bug reference',
  assignee: 'Assigned developer', retestDate: 'Retest date', retestResult: 'Retest result', remarks: 'Remarks', specRef: 'Spec ref', tcLink: 'Linked test case',
};
