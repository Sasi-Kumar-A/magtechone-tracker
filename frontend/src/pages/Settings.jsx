import { useEffect, useState } from 'react';
import { useTracker } from '../store.jsx';
import { Avatar, Field, Icon, ModPill, Pill } from '../components/ui.jsx';
import { MODULE_CODE_RE } from '../lib/rules.js';

export default function Settings() {
  const { user, theme, setTheme } = useTracker();
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Settings</h1><p className="muted">Your account, the look of the app, and the modules the team tests.</p></div>
      </div>

      <div className="grid2">
        <section className="card">
          <h2>Appearance</h2>
          <div className="theme-pick" role="radiogroup" aria-label="Theme">
            {[['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['system', 'Same as device', 'gear']].map(([v, l, ic]) => (
              <button key={v} role="radio" aria-checked={theme === v} className={`theme-opt ${v} ${theme === v ? 'on' : ''}`} onClick={() => setTheme(v)}>
                <span className="swatch" aria-hidden="true" />
                <span className="row gap"><Icon name={ic} size={16} />{l}</span>
              </button>
            ))}
          </div>
        </section>
        <Account user={user} />
      </div>

      <Modules />
      <DataSource />
    </div>
  );
}

function Account({ user }) {
  const { actions } = useTracker();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = again && next !== again;
  const ok = cur && next.length >= 8 && next === again;
  const submit = async (e) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    const r = await actions.changePassword(cur, next);
    setBusy(false);
    if (r) { setCur(''); setNext(''); setAgain(''); }
  };
  return (
    <section className="card">
      <h2>My account</h2>
      <div className="row gap acct">
        <Avatar name={user?.name} size={44} />
        <div className="grow"><strong>{user?.name}</strong><div className="muted small">@{user?.id}{user?.email ? ` · ${user.email}` : ''}</div></div>
        <Pill>{user?.role}</Pill>
      </div>
      <form className="form one" onSubmit={submit}>
        <Field label="Current password" id="pw-cur"><input id="pw-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="New password" id="pw-new" hint="At least 8 characters."><input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <Field label="Repeat new password" id="pw-again" hint={mismatch ? 'Passwords do not match.' : ''}><input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></Field>
        <div><button className="btn primary" disabled={!ok || busy}>{busy ? 'Saving…' : 'Change password'}</button></div>
      </form>
    </section>
  );
}

function Modules() {
  const { modules, testcases, bugs, actions, user } = useTracker();
  const canEdit = user?.role !== 'Developer';
  const [rows, setRows] = useState(modules);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  useEffect(() => setRows(modules), [modules]);
  const used = (c) => testcases.some((t) => t.module === c) || bugs.some((b) => b.module === c);
  const dirty = JSON.stringify(rows) !== JSON.stringify(modules);
  const codeOk = MODULE_CODE_RE.test(code) && !rows.some((m) => m.code.toLowerCase() === code.toLowerCase());

  const add = (e) => {
    e.preventDefault();
    if (!codeOk) return;
    setRows((r) => [...r, { code: code.trim(), name: name.trim() || code.trim() }]);
    setCode(''); setName('');
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Modules</h2>
        {canEdit && <button className="btn primary" disabled={!dirty} onClick={() => actions.saveModules(rows)}>Save modules</button>}
      </div>
      <p className="muted">Add a module before you write or import its test cases. The code is used in test case IDs (TC-<b>CODE</b>-001).</p>
      <div className="mod-list">
        {rows.map((m, i) => {
          const tc = testcases.filter((t) => t.module === m.code).length;
          const ob = bugs.filter((b) => b.module === m.code && b.status !== 'Closed').length;
          return (
            <div key={m.code} className="mod-row">
              <ModPill code={m.code} />
              <label className="sr" htmlFor={`mn-${m.code}`}>Name of {m.code}</label>
              <input id={`mn-${m.code}`} value={m.name} disabled={!canEdit} onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <span className="muted small nowrap">{tc} tests · {ob} open bugs</span>
              {canEdit && (used(m.code) ? <span className="in-use" title="Used by test cases or bugs">In use</span> : <button className="link danger" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>Remove</button>)}
            </div>
          );
        })}
      </div>
      {canEdit && (
        <form className="mod-add" onSubmit={add}>
          <Field label="New module code" id="mod-code" hint={code && !codeOk ? '2-12 letters/numbers, starting with a letter, not already used' : 'e.g. PAY, ATT, REC'}>
            <input id="mod-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\s/g, ''))} maxLength={12} />
          </Field>
          <Field label="Module name" id="mod-name" hint="Shown next to the code everywhere"><input id="mod-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Payroll" /></Field>
          <button className="btn" disabled={!codeOk}><Icon name="plus" /> Add</button>
        </form>
      )}
      {dirty && <p className="hint">You have unsaved changes. Click "Save modules".</p>}
    </section>
  );
}

function DataSource() {
  const { mode, modeLabel, lastSync, reload, actions } = useTracker();
  const [confirm, setConfirm] = useState(false);
  return (
    <section className="card">
      <h2>Data</h2>
      <dl className="facts">
        <div><dt>Stored in</dt><dd>{modeLabel}</dd></div>
        <div><dt>Last synced</dt><dd>{lastSync ? lastSync.toLocaleTimeString() : '—'}</dd></div>
      </dl>
      {mode === 'live' ? (
        <div className="row gap wrap mt-s">
          <p className="muted grow">Each save is a commit in the tracker repo under <code>data/</code>. The page refreshes every 30 seconds.</p>
          <button className="btn" onClick={() => reload()}><Icon name="refresh" /> Sync now</button>
        </div>
      ) : (
        <div className="mt-s">
          <p className="muted">Preview mode: changes stay in this browser only. Connect the Java backend (see README) to share data with the team through the GitHub repo.</p>
          {actions.resetDemo && (confirm ? (
            <div className="row gap wrap"><span>Reset all preview data?</span><button className="btn danger" onClick={() => { actions.resetDemo(); setConfirm(false); }}>Yes, reset</button><button className="btn" onClick={() => setConfirm(false)}>Cancel</button></div>
          ) : <button className="btn" onClick={() => setConfirm(true)}><Icon name="refresh" /> Reset preview data</button>)}
        </div>
      )}
    </section>
  );
}
