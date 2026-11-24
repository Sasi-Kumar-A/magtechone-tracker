import { useMemo, useRef, useState } from 'react';
import { useTracker } from '../store.jsx';
import { Icon, ModPill, Modal } from './ui.jsx';
import { readAnySheet } from '../lib/xlsx.js';
import { analyse, FIELD_LABELS } from '../lib/importer.js';

export default function ImportModal({ onClose }) {
  const data = useTracker();
  const { actions, toast, modules } = data;
  const [file, setFile] = useState(null);
  const [sheets, setSheets] = useState(null);
  const [onExisting, setOnExisting] = useState('skip');
  const [defaultModule, setDefaultModule] = useState('');
  const [bugsFromFails, setBugsFromFails] = useState(true);
  const [tab, setTab] = useState('new');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef(null);

  const result = useMemo(() => (sheets ? analyse(sheets, data, { onExisting, defaultModule, bugsFromFails }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheets, onExisting, defaultModule, bugsFromFails, data.testcases, data.bugs, data.modules, data.team]);
  const errors = result ? result.issues.filter((i) => i.level === 'error') : [];
  const warns = result ? result.issues.filter((i) => i.level === 'warn') : [];
  const total = result ? result.testcases.length + result.bugs.length : 0;
  const newTcs = result ? result.testcases.filter((t) => t._new) : [];
  const newBugs = result ? result.bugs.filter((b) => b._new) : [];

  const pick = async (f) => {
    if (!f) return;
    setErr(''); setSheets(null); setFile(f);
    try {
      setBusy(true);
      setSheets(await readAnySheet(f));
      setTab('new');
    } catch (e) {
      setErr(e.message || 'Could not read this file.');
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!result || total === 0) return;
    setBusy(true);
    const r = await actions.importData({ testcases: result.testcases, bugs: result.bugs, modules: result.modulesToCreate });
    setBusy(false);
    if (r) {
      const upd = result.stats.tcUpdate + result.stats.bugUpdate;
      toast(`Imported: ${result.stats.tcNew} new test cases, ${result.stats.bugNew} new bugs${upd ? `, ${upd} updated` : ''}`);
      onClose();
    }
  };

  const template = async () => {
    const { downloadTemplate } = await import('../lib/report.js');
    const f = await downloadTemplate(data, defaultModule || modules[0]?.code);
    toast(`Downloaded ${f}`);
  };

  const tabs = [
    ['new', `Will be added (${newTcs.length + newBugs.length})`],
    ['skipped', `Skipped (${result ? result.skipped.length : 0})`],
    ['columns', 'Columns found'],
    ['notes', `Notes (${errors.length + warns.length})`],
  ];

  return (
    <Modal title="Import test cases and bugs" onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!result || total === 0 || busy} onClick={run}>
          {busy && result ? 'Importing…' : result ? `Import ${total} record${total === 1 ? '' : 's'}` : 'Import'}
        </button>
      </>}>
      <div className="import">
        <div className={`drop ${drag ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}>
          <Icon name="upload" size={26} />
          <p><strong>{file ? file.name : 'Drop your Excel (.xlsx) or CSV file here'}</strong></p>
          <button className="btn" onClick={() => input.current?.click()}>{file ? 'Choose another file' : 'Choose file'}</button>
          <input ref={input} type="file" accept=".xlsx,.csv,.tsv,.txt" className="sr" onChange={(e) => pick(e.target.files[0])} aria-label="Excel or CSV file" />
          <p className="muted small">
            Any layout works: columns are recognised from their names (Scenario, Steps, Expected, Status / Result, Bug ID, Assigned to…), on any row.
            Test cases already in the tracker are found by their <b>content</b>, not their ID, so your own numbering (1, 01, 0001…) is fine.
            Failed tests also become bugs. Want a ready format? <button type="button" className="link" onClick={template}>Download the template</button> (optional).
          </p>
        </div>

        {err && <p className="error-text" role="alert">{err}</p>}
        {busy && !result && <div className="skeleton short" />}

        {result && (
          <>
            <div className="imp-opts">
              <label className="strong" htmlFor="imp-mod">Module for rows that don&apos;t name one:</label>
              <select id="imp-mod" value={defaultModule} onChange={(e) => setDefaultModule(e.target.value)}>
                <option value="">Auto (from the sheet name, else {modules[0]?.code})</option>
                {modules.map((m) => <option key={m.code} value={m.code}>{m.code} – {m.name}</option>)}
              </select>
            </div>
            <div className="imp-opts" role="radiogroup" aria-label="Records already in the tracker">
              <span className="strong">Same test case / bug already in the tracker:</span>
              {[['skip', 'Skip it'], ['update', 'Update it with the file values (results, dates, remarks…)']].map(([v, l]) => (
                <label key={v} className="radio"><input type="radio" name="onExisting" checked={onExisting === v} onChange={() => setOnExisting(v)} /> {l}</label>
              ))}
            </div>
            <label className="radio"><input type="checkbox" checked={bugsFromFails} onChange={(e) => setBugsFromFails(e.target.checked)} /> Create a bug for every <b>failed</b> test case (linked to it)</label>

            <div className="imp-stats">
              <div><strong>{result.stats.tcNew}</strong><span>new test cases</span></div>
              <div><strong>{result.stats.bugNew}</strong><span>new bugs{result.stats.bugsFromFails ? ` (${result.stats.bugsFromFails} from fails)` : ''}</span></div>
              <div><strong>{result.stats.tcUpdate + result.stats.bugUpdate}</strong><span>updated</span></div>
              <div><strong>{result.stats.tcSkip + result.stats.bugSkip}</strong><span>already in tracker</span></div>
              <div className={result.stats.invalid ? 'bad' : ''}><strong>{result.stats.invalid}</strong><span>not usable</span></div>
            </div>

            {result.modulesToCreate.length > 0 && (
              <div className="callout soft"><span>New modules will be created: {result.modulesToCreate.map((m) => <ModPill key={m.code} code={m.code} />)}</span></div>
            )}

            <div className="imp-tabs" role="tablist">
              {tabs.map(([v, l]) => (
                <button key={v} type="button" role="tab" aria-selected={tab === v} className={tab === v ? 'on' : ''} onClick={() => setTab(v)}>{l}</button>
              ))}
            </div>

            <div className="imp-issues">
              {tab === 'new' && (
                <ul>
                  {newTcs.slice(0, 150).map((t) => <li key={t.id}><span className="tag ok">{t.id}</span> {t.scenario} <span className="muted">· {t.status}{t.sourceId ? ` · your ID ${t.sourceId}` : ''}</span></li>)}
                  {newBugs.slice(0, 150).map((b) => <li key={b.id}><span className="tag bad">{b.id}</span> {b.title} <span className="muted">· {b.severity}{b.testCaseId ? ` · from ${b.testCaseId}` : ''}</span></li>)}
                  {!newTcs.length && !newBugs.length && <li className="muted">Nothing new in this file.</li>}
                </ul>
              )}
              {tab === 'skipped' && (
                <ul>
                  {result.skipped.slice(0, 200).map((s, k) => <li key={k} className="warn"><span className="tag">{s.sheet} row {s.row}</span> {s.text} <span className="muted">— {s.reason}</span></li>)}
                  {!result.skipped.length && <li className="muted">Nothing skipped.</li>}
                </ul>
              )}
              {tab === 'columns' && result.mappings.map((m) => (
                <div key={m.sheet} className="mt-s">
                  <strong>{m.sheet}</strong> <span className="muted">— read as {m.kind === 'tests' ? 'test cases' : 'bugs'}, header on row {m.headerRow}</span>
                  <ul>{m.columns.map((c) => <li key={c.from + c.to}>“{c.from}” → <b>{FIELD_LABELS[c.to] || c.to}</b></li>)}</ul>
                </div>
              ))}
              {tab === 'columns' && !result.mappings.length && <p className="muted">No table found.</p>}
              {tab === 'notes' && (
                <ul>
                  {[...errors, ...warns].slice(0, 150).map((i, k) => <li key={k} className={i.level}>{i.sheet && <span className="muted">{i.sheet}{i.row ? ` row ${i.row}` : ''}:</span>} {i.text}</li>)}
                  {!errors.length && !warns.length && <li className="muted">No notes.</li>}
                </ul>
              )}
            </div>
            <p className="muted small">Read: {result.sheetsUsed.join(', ') || 'nothing usable'}. Other sheets (summary, test data…) are ignored.</p>
          </>
        )}
      </div>
    </Modal>
  );
}
