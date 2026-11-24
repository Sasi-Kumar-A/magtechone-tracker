import { useMemo, useState } from 'react';
import { useTracker } from '../store.jsx';
import DownloadReport from '../components/DownloadReport.jsx';
import { Empty, Field, Icon, ModPill, Modal, Pill, Select } from '../components/ui.jsx';
import { PRIORITIES, TC_STATUSES, fmtDate, matches, memberName, nextTestCaseId } from '../lib/rules.js';

export default function TestCases({ q, setQ, openTest, openImport }) {
  const { testcases, team, loading, modules } = useTracker();
  const [mod, setMod] = useState('All');
  const [status, setStatus] = useState('All');
  const [prio, setPrio] = useState('All');
  const [tester, setTester] = useState('All');
  const [adding, setAdding] = useState(false);

  const list = useMemo(() => testcases
    .filter((t) => (mod === 'All' || t.module === mod)
      && (status === 'All' || t.status === status)
      && (prio === 'All' || t.priority === prio)
      && (tester === 'All' || t.testedBy === tester)
      && matches(t, q, ['id', 'scenario', 'screen', 'loginAs', 'specRef', 'remarks']))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })), [testcases, mod, status, prio, tester, q]);

  const counts = Object.fromEntries(TC_STATUSES.map((s) => [s, testcases.filter((t) => t.status === s).length]));
  const testers = [...new Set(testcases.map((t) => t.testedBy).filter(Boolean))];
  const filtered = mod !== 'All' || status !== 'All' || prio !== 'All' || tester !== 'All' || q;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Test cases</h1>
          <p className="muted">Anyone on the team can add, edit and record results. Click a row to open it.</p>
        </div>
        <div className="row gap wrap">
          <DownloadReport />
          <button className="btn" onClick={openImport}><Icon name="upload" /> Import Excel</button>
          <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" /> New test case</button>
        </div>
      </div>

      <div className="chips" role="group" aria-label="Filter by status">
        {['All', ...TC_STATUSES].map((s) => (
          <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)} aria-pressed={status === s}>
            {s} <span>{s === 'All' ? testcases.length : counts[s]}</span>
          </button>
        ))}
      </div>

      <div className="toolbar card">
        <div className="search">
          <Icon name="search" />
          <label htmlFor="tc-q" className="sr">Search test cases</label>
          <input id="tc-q" type="search" placeholder="Search ID, scenario, screen…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Field label="Module" id="f-mod"><Select id="f-mod" value={mod} onChange={setMod} options={[{ value: 'All', label: 'All modules' }, ...modules.map((m) => ({ value: m.code, label: `${m.code} · ${m.name}` }))]} /></Field>
        <Field label="Priority" id="f-prio"><Select id="f-prio" value={prio} onChange={setPrio} options={['All', ...PRIORITIES]} /></Field>
        <Field label="Tested by" id="f-tester"><Select id="f-tester" value={tester} onChange={setTester} options={[{ value: 'All', label: 'Anyone' }, ...testers.map((t) => ({ value: t, label: memberName(team, t) }))]} /></Field>
        <div className="toolbar-end">
          <span className="muted">{list.length} of {testcases.length}</span>
          {filtered && <button className="link" onClick={() => { setMod('All'); setStatus('All'); setPrio('All'); setTester('All'); setQ(''); }}>Clear filters</button>}
        </div>
      </div>

      <div className="card flush">
        {loading ? <div className="skeleton" /> : list.length === 0 ? (
          <Empty title="No test cases match">Try clearing the filters or search.</Empty>
        ) : (
          <div className="scroll">
            <table className="table stack">
              <thead>
                <tr><th>TC ID</th><th>Module</th><th>Scenario</th><th>Login as</th><th>Priority</th><th>Status</th><th>Tested by</th><th>Date</th><th>Bugs</th></tr>
              </thead>
              <tbody>
                {list.map((t) => (
                  <tr key={t.id} onClick={() => openTest(t.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openTest(t.id)}>
                    <td data-l="TC ID" className="mono strong">{t.id}</td>
                    <td data-l="Module"><ModPill code={t.module} /></td>
                    <td data-l="Scenario" className="scenario"><span>{t.scenario}</span><small className="muted">{t.screen}</small></td>
                    <td data-l="Login as" className="muted">{t.loginAs}</td>
                    <td data-l="Priority"><Pill>{t.priority}</Pill></td>
                    <td data-l="Status"><Pill>{t.status}</Pill></td>
                    <td data-l="Tested by">{t.testedBy ? memberName(team, t.testedBy) : <span className="muted">—</span>}</td>
                    <td data-l="Date" className="nowrap">{t.testedOn ? fmtDate(t.testedOn) : <span className="muted">—</span>}</td>
                    <td data-l="Bugs">{t.bugIds?.length ? <span className="badge">{t.bugIds.length}</span> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {adding && <NewTestCase onClose={() => setAdding(false)} onCreated={(id) => { setAdding(false); openTest(id); }} />}
    </div>
  );
}

function NewTestCase({ onClose, onCreated }) {
  const { testcases, actions, modules } = useTracker();
  const [f, setF] = useState({ module: modules[0]?.code || '', screen: '', scenario: '', loginAs: '', precondition: '', steps: '', expected: '', priority: 'Medium', specRef: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: typeof v === 'string' ? v : v.target.value }));
  const id = nextTestCaseId(testcases, f.module);
  const ok = f.scenario.trim() && f.steps.trim() && f.expected.trim();

  const submit = async (e) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    const r = await actions.createTestCase({ ...f, id, status: 'Not run', bugIds: [], testedBy: '', testedOn: '', remarks: '' });
    setBusy(false);
    if (r) onCreated(r.id);
  };

  return (
    <Modal title={`New test case · ${id}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" form="new-tc" disabled={!ok || busy}>{busy ? 'Saving…' : 'Add test case'}</button></>}>
      <form id="new-tc" className="form" onSubmit={submit}>
        <Field label="Module" id="n-mod"><Select id="n-mod" value={f.module} onChange={set('module')} options={modules.map((m) => ({ value: m.code, label: `${m.code} · ${m.name}` }))} /></Field>
        <Field label="Priority" id="n-prio"><Select id="n-prio" value={f.priority} onChange={set('priority')} options={PRIORITIES} /></Field>
        <Field label="Scenario *" id="n-sc" wide><input id="n-sc" value={f.scenario} onChange={set('scenario')} placeholder="e.g. Approve 2-day leave at Head level" /></Field>
        <Field label="Screen" id="n-scr"><input id="n-scr" value={f.screen} onChange={set('screen')} placeholder="e.g. WFL-01.2" /></Field>
        <Field label="Login as" id="n-login"><input id="n-login" value={f.loginAs} onChange={set('loginAs')} placeholder="e.g. Reporting manager (RM)" /></Field>
        <Field label="Pre-condition" id="n-pre" wide><input id="n-pre" value={f.precondition} onChange={set('precondition')} /></Field>
        <Field label="Steps *" id="n-steps" wide><textarea id="n-steps" rows={4} value={f.steps} onChange={set('steps')} placeholder={'1. …\n2. …'} /></Field>
        <Field label="Expected result *" id="n-exp" wide><textarea id="n-exp" rows={3} value={f.expected} onChange={set('expected')} /></Field>
        <Field label="Spec ref" id="n-spec"><input id="n-spec" value={f.specRef} onChange={set('specRef')} /></Field>
      </form>
    </Modal>
  );
}
