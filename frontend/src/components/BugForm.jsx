import { useState } from 'react';
import { useTracker } from '../store.jsx';
import { Field, Modal, Select } from './ui.jsx';
import { SEVERITIES } from '../lib/rules.js';

export function developerOptions(team) {
  return [{ value: '', label: 'Unassigned' }, ...team.filter((m) => m.role === 'Developer').map((m) => ({ value: m.id, label: m.github ? `${m.name} (@${m.github})` : m.name }))];
}

export function notifyHint(team, assignee, mode) {
  if (!assignee) return 'Nobody is notified until a developer is assigned.';
  const dev = team.find((m) => m.id === assignee);
  if (!dev) return '';
  if (mode === 'live') return dev.github ? `GitHub will notify @${dev.github}. Only they can close this bug.` : `${dev.name} has no GitHub username in Team settings, so no notification can be sent.`;
  return `In live mode GitHub notifies ${dev.github ? '@' + dev.github : dev.name}. Only they can close this bug.`;
}

export default function BugForm({ fromTest, onClose, onCreated }) {
  const { testcases, team, actions, mode, modules } = useTracker();
  const [f, setF] = useState(() => ({
    title: fromTest ? `${fromTest.scenario}: ` : '',
    module: fromTest?.module || modules[0]?.code || '',
    severity: 'Medium',
    testCaseId: fromTest?.id || '',
    assignee: '',
    steps: fromTest?.steps || '',
    expected: fromTest?.expected || '',
    actual: fromTest?.remarks || '',
    notes: '',
  }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: typeof v === 'string' ? v : v.target.value }));
  const ok = f.title.trim().length > 3 && f.actual.trim();

  const submit = async (e) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    const r = await actions.createBug({ ...f, title: f.title.trim() });
    setBusy(false);
    if (r) onCreated(r.id);
  };

  const tcOptions = [{ value: '', label: 'None' }, ...testcases.map((t) => ({ value: t.id, label: `${t.id} · ${t.scenario}` }))];

  return (
    <Modal title={fromTest ? `Report bug from ${fromTest.id}` : 'Report a bug'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" form="bug-form" disabled={!ok || busy}>{busy ? 'Creating…' : 'Create bug'}</button></>}>
      <form id="bug-form" className="form" onSubmit={submit}>
        <Field label="Title *" id="b-title" wide><input id="b-title" value={f.title} onChange={set('title')} placeholder="What is wrong, where" autoFocus /></Field>
        <Field label="Module" id="b-mod"><Select id="b-mod" value={f.module} onChange={set('module')} options={modules.map((m) => ({ value: m.code, label: `${m.code} · ${m.name}` }))} /></Field>
        <Field label="Severity" id="b-sev"><Select id="b-sev" value={f.severity} onChange={set('severity')} options={SEVERITIES} /></Field>
        <Field label="Linked test case" id="b-tc"><Select id="b-tc" value={f.testCaseId} onChange={set('testCaseId')} options={tcOptions} /></Field>
        <Field label="Assign to developer" id="b-as" hint={notifyHint(team, f.assignee, mode)}><Select id="b-as" value={f.assignee} onChange={set('assignee')} options={developerOptions(team)} /></Field>
        <Field label="Steps to reproduce" id="b-steps" wide><textarea id="b-steps" rows={4} value={f.steps} onChange={set('steps')} /></Field>
        <Field label="Expected result" id="b-exp"><textarea id="b-exp" rows={3} value={f.expected} onChange={set('expected')} /></Field>
        <Field label="Actual result *" id="b-act"><textarea id="b-act" rows={3} value={f.actual} onChange={set('actual')} /></Field>
        <Field label="Notes" id="b-notes" wide><textarea id="b-notes" rows={2} value={f.notes} onChange={set('notes')} placeholder="Build, browser, error code, related bugs…" /></Field>
      </form>
    </Modal>
  );
}
