import { useTracker } from '../store.jsx';
import { Avatar, ModPill, Pill, Icon } from '../components/ui.jsx';
import { BUG_STATUSES, SEVERITIES, TC_STATUSES, memberName, timeAgo } from '../lib/rules.js';

const SEG = { Pass: 'var(--ok)', Fail: 'var(--bad)', Blocked: 'var(--warn)', 'N/A': 'var(--na)', 'Not run': 'var(--track)' };

function Stacked({ counts, total }) {
  if (!total) return <span className="muted small">No tests yet</span>;
  return (
    <div className="stack-bar" role="img" aria-label={TC_STATUSES.map((s) => `${counts[s] || 0} ${s}`).join(', ')}>
      {TC_STATUSES.map((s) => counts[s] ? <div key={s} style={{ width: `${(counts[s] / total) * 100}%`, background: SEG[s] }} title={`${s}: ${counts[s]}`} /> : null)}
    </div>
  );
}

function Bar({ label, value, max, color }) {
  return (
    <div className="hbar">
      <span className="hbar-label">{label}</span>
      <div className="hbar-track"><div style={{ width: max ? `${(value / max) * 100}%` : 0, background: color }} /></div>
      <span className="num">{value}</span>
    </div>
  );
}

export default function Dashboard({ openBug, openTest, go }) {
  const { testcases, bugs, team, user, modules } = useTracker();
  const total = testcases.length;
  const count = (list, key, val) => list.filter((x) => x[key] === val).length;
  const executed = testcases.filter((t) => t.status !== 'Not run').length;
  const pass = count(testcases, 'status', 'Pass');
  const fail = count(testcases, 'status', 'Fail');
  const na = count(testcases, 'status', 'N/A');
  const passRate = executed - na > 0 ? Math.round((pass / (executed - na)) * 100) : 0;
  const open = bugs.filter((b) => b.status !== 'Closed');
  const sev = Object.fromEntries(SEVERITIES.map((s) => [s, open.filter((b) => b.severity === s).length]));
  const execPct = total ? Math.round((executed / total) * 100) : 0;

  const urgent = open.filter((b) => b.severity === 'Critical' || b.severity === 'High').slice(0, 6);
  const mine = user ? open.filter((b) => b.assignee === user.id) : [];
  const unassigned = open.filter((b) => !b.assignee).length;

  const activity = [
    ...testcases.flatMap((t) => (t.history || []).slice(0, 3).map((h) => ({ ...h, ref: t.id, kind: 'test' }))),
    ...bugs.flatMap((b) => (b.history || []).slice(0, 3).map((h) => ({ ...h, ref: b.id, kind: 'bug' }))),
  ].filter((a) => a.by !== 'import').sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 8);

  const headline = executed === 0
    ? `${total} test cases ready, none run yet`
    : `${execPct}% of tests run · ${passRate}% passing`;

  return (
    <div className="page">
      <section className="hero">
        <div className="hero-text">
          <p className="hero-kicker">MagTech One · {modules.map((m) => m.code).join(' · ')}</p>
          <h1>{headline}</h1>
          <p>{open.length} open bugs{unassigned ? `, ${unassigned} not assigned to a developer yet` : ''}. Everyone on the team sees this page update as results come in.</p>
          <div className="hero-actions">
            <button className="btn light" onClick={() => go('testcases')}><Icon name="tests" /> Run tests</button>
            <button className="btn ghost-light" onClick={() => go('bugs')}><Icon name="bug" /> Open bug board</button>
          </div>
        </div>
        <div className="ring" style={{ '--p': execPct }} role="img" aria-label={`${execPct}% of test cases executed`}>
          <div><strong>{execPct}%</strong><span>executed</span></div>
        </div>
      </section>

      <section className="kpis">
        <div className="kpi"><span>Test cases</span><strong>{total}</strong><em>{modules.filter((m) => count(testcases, 'module', m.code)).map((m) => `${m.code} ${count(testcases, 'module', m.code)}`).join(' · ') || 'No test cases yet'}</em></div>
        <div className="kpi"><span>Executed</span><strong>{executed}</strong><em>{total - executed} not run</em></div>
        <div className="kpi"><span>Pass rate</span><strong>{passRate}%</strong><em>{pass} pass · {fail} fail</em></div>
        <div className="kpi"><span>Open bugs</span><strong>{open.length}</strong><em>{sev.Critical + sev.High} high+ · {sev.Medium} med · {sev.Low} low</em></div>
      </section>

      <section className="card flush">
        <div className="card-head pad"><h2>Status by module</h2><span className="muted small">Updates as soon as anyone saves a result</span></div>
        <div className="scroll">
          <table className="table stack modtable">
            <thead><tr><th>Module</th><th>Progress</th><th className="r">Tests</th><th className="r">Pass</th><th className="r">Fail</th><th className="r">Blocked</th><th className="r">Not run</th><th className="r">Pass %</th><th className="r">Open bugs</th></tr></thead>
            <tbody>
              {modules.map((m) => {
                const list = testcases.filter((t) => t.module === m.code);
                const c = Object.fromEntries(TC_STATUSES.map((s) => [s, count(list, 'status', s)]));
                const ex = list.length - c['Not run'] - c['N/A'];
                const ob = open.filter((b) => b.module === m.code).length;
                return (
                  <tr key={m.code} onClick={() => go('testcases')}>
                    <td data-l="Module"><span className="row gap"><ModPill code={m.code} /><span className="muted small">{m.name}</span></span></td>
                    <td data-l="Progress" className="prog"><Stacked counts={c} total={list.length} /></td>
                    <td data-l="Tests" className="num">{list.length}</td>
                    <td data-l="Pass" className="num ok-t">{c.Pass}</td>
                    <td data-l="Fail" className="num bad-t">{c.Fail}</td>
                    <td data-l="Blocked" className="num warn-t">{c.Blocked}</td>
                    <td data-l="Not run" className="num">{c['Not run']}</td>
                    <td data-l="Pass %" className="num">{ex > 0 ? `${Math.round((c.Pass / ex) * 100)}%` : '—'}</td>
                    <td data-l="Open bugs" className="num">{ob}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="legend pad">{TC_STATUSES.map((s) => <span key={s}><i style={{ background: SEG[s] }} />{s}</span>)}</div>
      </section>

      <div className="grid2">
        <section className="card">
          <h2>Bugs by status</h2>
          {BUG_STATUSES.map((s) => <Bar key={s} label={s} value={count(bugs, 'status', s)} max={bugs.length} color="var(--accent-grad)" />)}
        </section>
        <section className="card">
          <h2>Open bugs by severity</h2>
          {SEVERITIES.map((s) => <Bar key={s} label={s} value={sev[s]} max={open.length} color="var(--accent-grad)" />)}
        </section>
      </div>

      <div className="grid2">
        <section className="card">
          <div className="card-head"><h2>High-severity bugs</h2><button className="link" onClick={() => go('bugs')}>View board</button></div>
          {urgent.length === 0 ? <p className="muted">No high-severity bugs open.</p> : (
            <ul className="list">
              {urgent.map((b) => (
                <li key={b.id}>
                  <button className="row-btn" onClick={() => openBug(b.id)}>
                    <span className="mono">{b.id}</span>
                    <span className="grow">{b.title}</span>
                    <Pill>{b.severity}</Pill>
                    <Avatar name={memberName(team, b.assignee)} size={26} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          {user?.role === 'Developer' ? (
            <>
              <div className="card-head"><h2>Assigned to me</h2><span className="muted">{mine.length}</span></div>
              {mine.length === 0 ? <p className="muted">Nothing assigned to you right now.</p> : (
                <ul className="list">{mine.map((b) => (
                  <li key={b.id}><button className="row-btn" onClick={() => openBug(b.id)}><span className="mono">{b.id}</span><span className="grow">{b.title}</span><Pill>{b.status}</Pill></button></li>
                ))}</ul>
              )}
            </>
          ) : (
            <>
              <div className="card-head"><h2>Recent activity</h2></div>
              {activity.length === 0 ? <p className="muted">No changes yet. Record a test result or update a bug and it shows up here for everyone.</p> : (
                <ul className="list">{activity.map((a, i) => (
                  <li key={i}><button className="row-btn" onClick={() => (a.kind === 'bug' ? openBug(a.ref) : openTest(a.ref))}>
                    <Avatar name={memberName(team, a.by)} size={26} />
                    <span className="grow"><strong>{memberName(team, a.by)}</strong> · {a.ref} · {a.action}</span>
                    <span className="muted nowrap">{timeAgo(a.at)}</span>
                  </button></li>
                ))}</ul>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
