import { useEffect, useState } from 'react';
import { useTracker } from '../store.jsx';
import { Avatar, Drawer, Field, Icon, ModPill, Pill, Select } from './ui.jsx';
import { developerOptions, notifyHint } from './BugForm.jsx';
import { BUG_STATUSES, SEVERITIES, canClose, closeBlockReason, fmtDate, memberName, timeAgo } from '../lib/rules.js';

export default function BugDrawer({ id, onClose, openTest }) {
  const { bugs, team, user, actions, mode, modules } = useTracker();
  const bug = bugs.find((b) => b.id === id);
  const [draft, setDraft] = useState(bug);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setDraft(bug); }, [bug]);
  if (!bug || !draft) return null;

  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: typeof v === 'string' ? v : v.target.value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(bug);
  const allowedClose = canClose(draft, user);
  const statusOptions = BUG_STATUSES.map((s) => ({
    value: s,
    label: s === 'Closed' && !allowedClose && bug.status !== 'Closed' ? 'Closed (assigned developer only)' : s,
    disabled: s === 'Closed' && !allowedClose && bug.status !== 'Closed',
  }));

  const save = async () => {
    setBusy(true);
    await actions.updateBug(draft);
    setBusy(false);
  };
  const quick = async (status) => {
    setBusy(true);
    await actions.updateBug({ ...bug, status }, `${bug.id} → ${status}`);
    setBusy(false);
  };

  return (
    <Drawer
      title={bug.title}
      subtitle={<span className="row gap"><span className="mono">{bug.id}</span><ModPill code={bug.module} /><Pill>{bug.severity}</Pill><Pill>{bug.status}</Pill></span>}
      onClose={onClose}
      footer={<>
        {bug.status === 'Closed'
          ? <button className="btn" disabled={busy} onClick={() => quick('Open')}>Reopen</button>
          : allowedClose && <button className="btn ok" disabled={busy} onClick={() => quick('Closed')}>Close bug</button>}
        <button className="btn primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
      </>}
    >
      {!allowedClose && bug.status !== 'Closed' && (
        <div className="callout"><Icon name="lock" /><span>{closeBlockReason(draft, team)}</span></div>
      )}
      <div className="form">
        <Field label="Title" id="d-title" wide><input id="d-title" value={draft.title} onChange={set('title')} /></Field>
        <Field label="Status" id="d-status"><Select id="d-status" value={draft.status} onChange={set('status')} options={statusOptions} /></Field>
        <Field label="Assigned developer" id="d-as" hint={notifyHint(team, draft.assignee, mode)}><Select id="d-as" value={draft.assignee} onChange={set('assignee')} options={developerOptions(team)} /></Field>
        <Field label="Severity" id="d-sev"><Select id="d-sev" value={draft.severity} onChange={set('severity')} options={SEVERITIES} /></Field>
        <Field label="Module" id="d-mod"><Select id="d-mod" value={draft.module} onChange={set('module')} options={modules.map((m) => m.code)} /></Field>
        <Field label="Steps to reproduce" id="d-steps" wide><textarea id="d-steps" rows={4} value={draft.steps} onChange={set('steps')} /></Field>
        <Field label="Expected result" id="d-exp"><textarea id="d-exp" rows={3} value={draft.expected} onChange={set('expected')} /></Field>
        <Field label="Actual result" id="d-act"><textarea id="d-act" rows={3} value={draft.actual} onChange={set('actual')} /></Field>
        <Field label="Notes" id="d-notes" wide><textarea id="d-notes" rows={3} value={draft.notes} onChange={set('notes')} /></Field>
      </div>

      <dl className="facts">
        <div><dt>Reported</dt><dd>{memberName(team, bug.reporter)} · {fmtDate(bug.createdAt)}</dd></div>
        <div><dt>Test case</dt><dd>{bug.testCaseId ? <button className="link" onClick={() => openTest(bug.testCaseId)}>{bug.testCaseId}</button> : '—'}</dd></div>
        <div><dt>Closed</dt><dd>{bug.closedAt ? `${memberName(team, bug.closedBy)} · ${fmtDate(bug.closedAt)}` : '—'}</dd></div>
        <div><dt>GitHub issue</dt><dd>{bug.githubIssue ? <a href={bug.githubIssue.url} target="_blank" rel="noreferrer">#{bug.githubIssue.number}</a> : '—'}</dd></div>
      </dl>

      <section className="block">
        <h3>History</h3>
        <ul className="timeline">
          {(bug.history || []).slice(0, 15).map((h, i) => (
            <li key={i}><Avatar name={memberName(team, h.by)} size={24} /><div><strong>{memberName(team, h.by)}</strong> {h.action}<small>{timeAgo(h.at)}</small></div></li>
          ))}
        </ul>
      </section>
    </Drawer>
  );
}
