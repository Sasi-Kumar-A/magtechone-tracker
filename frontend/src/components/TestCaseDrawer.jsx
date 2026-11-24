import { useEffect, useState } from 'react';
import { useTracker } from '../store.jsx';
import { Avatar, Drawer, Field, Icon, ModPill, Pill, Select } from './ui.jsx';
import { PRIORITIES, TC_STATUSES, fmtDate, memberName, timeAgo, todayIso } from '../lib/rules.js';

export default function TestCaseDrawer({ id, onClose, onReportBug, openBug }) {
  const { testcases, bugs, team, user, actions, modules } = useTracker();
  const tc = testcases.find((t) => t.id === id);
  const [result, setResult] = useState(tc?.status || 'Not run');
  const [remarks, setRemarks] = useState(tc?.remarks || '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tc);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (tc && !editing) { setDraft(tc); }
  }, [tc, editing]);
  useEffect(() => {
    if (tc) { setResult(tc.status); setRemarks(tc.remarks || ''); }
    // only when switching to another test case
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!tc) return null;
  const linked = bugs.filter((b) => (tc.bugIds || []).includes(b.id) || b.testCaseId === tc.id);
  const resultChanged = result !== tc.status || remarks !== (tc.remarks || '');

  const saveResult = async () => {
    setBusy(true);
    await actions.updateTestCase({
      ...tc, status: result, remarks, testedBy: result === 'Not run' ? '' : user.id, testedOn: result === 'Not run' ? '' : todayIso(),
      _action: `Marked ${result}${remarks ? ' · remarks added' : ''}`,
    }, `${tc.id} marked ${result}`);
    setBusy(false);
  };

  const saveEdit = async () => {
    setBusy(true);
    const r = await actions.updateTestCase({ ...draft, _action: 'Edited details' });
    setBusy(false);
    if (r) setEditing(false);
  };

  const set = (k) => (v) => setDraft((d) => ({ ...d, [k]: typeof v === 'string' ? v : v.target.value }));

  return (
    <Drawer
      title={tc.scenario}
      subtitle={<span className="row gap"><span className="mono">{tc.id}</span><ModPill code={tc.module} /><Pill>{tc.priority}</Pill><Pill>{tc.status}</Pill></span>}
      onClose={onClose}
      footer={editing ? (
        <><button className="btn" onClick={() => { setEditing(false); setDraft(tc); }}>Cancel</button><button className="btn primary" disabled={busy} onClick={saveEdit}>{busy ? 'Saving…' : 'Save changes'}</button></>
      ) : (
        <><button className="btn" onClick={() => setEditing(true)}><Icon name="edit" /> Edit details</button><button className="btn primary" disabled={!resultChanged || busy} onClick={saveResult}>{busy ? 'Saving…' : 'Save result'}</button></>
      )}
    >
      {editing ? (
        <div className="form">
          <Field label="Scenario" id="e-sc" wide><input id="e-sc" value={draft.scenario} onChange={set('scenario')} /></Field>
          <Field label="Module" id="e-mod"><Select id="e-mod" value={draft.module} onChange={set('module')} options={modules.map((m) => m.code)} /></Field>
          <Field label="Priority" id="e-prio"><Select id="e-prio" value={draft.priority} onChange={set('priority')} options={PRIORITIES} /></Field>
          <Field label="Screen" id="e-scr"><input id="e-scr" value={draft.screen} onChange={set('screen')} /></Field>
          <Field label="Login as" id="e-login"><input id="e-login" value={draft.loginAs} onChange={set('loginAs')} /></Field>
          <Field label="Pre-condition" id="e-pre" wide><input id="e-pre" value={draft.precondition} onChange={set('precondition')} /></Field>
          <Field label="Steps" id="e-steps" wide><textarea id="e-steps" rows={5} value={draft.steps} onChange={set('steps')} /></Field>
          <Field label="Expected result" id="e-exp" wide><textarea id="e-exp" rows={3} value={draft.expected} onChange={set('expected')} /></Field>
          <Field label="Spec ref" id="e-spec"><input id="e-spec" value={draft.specRef} onChange={set('specRef')} /></Field>
        </div>
      ) : (
        <>
          <dl className="facts">
            <div><dt>Login as</dt><dd>{tc.loginAs || '—'}</dd></div>
            <div><dt>Screen</dt><dd>{tc.screen || '—'}</dd></div>
            <div><dt>Spec ref</dt><dd>{tc.specRef || '—'}</dd></div>
            <div><dt>Last tested</dt><dd>{tc.testedBy ? `${memberName(team, tc.testedBy)} · ${fmtDate(tc.testedOn)}` : 'Not run yet'}</dd></div>
          </dl>
          {tc.precondition && <section className="block"><h3>Pre-condition</h3><p>{tc.precondition}</p></section>}
          <section className="block"><h3>Steps</h3><p className="pre">{tc.steps}</p></section>
          <section className="block"><h3>Expected result</h3><p className="pre">{tc.expected}</p></section>

          <section className="block result">
            <h3>Record result</h3>
            <div className="result-btns" role="radiogroup" aria-label="Result">
              {TC_STATUSES.map((s) => (
                <button key={s} role="radio" aria-checked={result === s} className={`res ${s.replace(/\W/g, '').toLowerCase()} ${result === s ? 'on' : ''}`} onClick={() => setResult(s)}>{s}</button>
              ))}
            </div>
            <Field label="Remarks" id="tc-rem"><textarea id="tc-rem" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="What did you see? Data used, build number…" /></Field>
            <p className="hint">Saved as {user?.name} · {fmtDate(todayIso())}</p>
            {result === 'Fail' && (
              <div className="callout bad">
                <span>This test failed. Report a bug so a developer can fix it. It will be linked to {tc.id}.</span>
                <button className="btn danger" onClick={() => onReportBug(tc)}><Icon name="bug" /> Report bug</button>
              </div>
            )}
          </section>
        </>
      )}

      <section className="block">
        <h3>Linked bugs</h3>
        {linked.length === 0 ? <p className="muted">None.</p> : (
          <ul className="list">{linked.map((b) => (
            <li key={b.id}><button className="row-btn" onClick={() => openBug(b.id)}><span className="mono">{b.id}</span><span className="grow">{b.title}</span><Pill>{b.status}</Pill></button></li>
          ))}</ul>
        )}
      </section>

      <section className="block">
        <h3>History</h3>
        <ul className="timeline">
          {(tc.history || []).slice(0, 12).map((h, i) => (
            <li key={i}><Avatar name={memberName(team, h.by)} size={24} /><div><strong>{memberName(team, h.by)}</strong> {h.action}<small>{timeAgo(h.at)}</small></div></li>
          ))}
        </ul>
      </section>
    </Drawer>
  );
}
