import { useMemo, useState } from 'react';
import { useTracker } from '../store.jsx';
import { Avatar, Empty, Field, Icon, ModPill, Pill, Select } from '../components/ui.jsx';
import { developerOptions } from '../components/BugForm.jsx';
import { BUG_STATUSES, SEVERITIES, canClose, closeBlockReason, fmtDate, matches, memberName, timeAgo } from '../lib/rules.js';

const SEV_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const PAGE = 20;

function readView() { try { return localStorage.getItem('mt-bug-view') || 'cards'; } catch { return 'cards'; } }

export default function Bugs({ q, setQ, openBug, openTest, newBug, openImport }) {
  const { bugs, team, user, actions, toast, modules } = useTracker();
  const [status, setStatus] = useState('Open');
  const [mod, setMod] = useState('All');
  const [sev, setSev] = useState('All');
  const [who, setWho] = useState('All');
  const [view, setViewState] = useState(readView);
  const [limit, setLimit] = useState(PAGE);
  const setView = (v) => { setViewState(v); try { localStorage.setItem('mt-bug-view', v); } catch { /* ignore */ } };

  const base = useMemo(() => bugs.filter((b) => (mod === 'All' || b.module === mod)
    && (sev === 'All' || b.severity === sev)
    && (who === 'All' || (who === 'me' ? b.assignee === user?.id : who === 'none' ? !b.assignee : b.assignee === who))
    && matches(b, q, ['id', 'title', 'module', 'actual', 'expected', 'steps', 'notes', 'testCaseId']))
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.updatedAt.localeCompare(a.updatedAt)), [bugs, mod, sev, who, q, user]);
  const list = status === 'All' ? base : base.filter((b) => b.status === status);
  const counts = Object.fromEntries(BUG_STATUSES.map((s) => [s, base.filter((b) => b.status === s).length]));

  const update = async (bug, patch, msg) => {
    const next = { ...bug, ...patch };
    if (patch.status === 'Closed' && bug.status !== 'Closed' && !canClose(next, user)) {
      toast(closeBlockReason(next, team), 'err');
      return;
    }
    await actions.updateBug(next, msg);
  };

  const whoOptions = [
    { value: 'All', label: 'Anyone' }, { value: 'me', label: 'Assigned to me' }, { value: 'none', label: 'Unassigned' },
    ...team.filter((m) => m.role === 'Developer').map((m) => ({ value: m.id, label: m.name })),
  ];
  const filtered = mod !== 'All' || sev !== 'All' || who !== 'All' || q;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Bugs</h1>
          <p className="muted">Every bug with its details. Assign a developer right on the card; they get notified and only they can close it.</p>
        </div>
        <div className="row gap wrap">
            <div className="seg" role="group" aria-label="Layout">
              <button className={view === 'cards' ? 'on' : ''} aria-pressed={view === 'cards'} onClick={() => setView('cards')}><Icon name="cards" size={16} /> Cards</button>
              <button className={view === 'board' ? 'on' : ''} aria-pressed={view === 'board'} onClick={() => setView('board')}><Icon name="board" size={16} /> Board</button>
            </div>
          <button className="btn" onClick={openImport}><Icon name="upload" /> Import Excel</button>
          <button className="btn primary" onClick={newBug}><Icon name="plus" /> Report bug</button>
        </div>
      </div>

      <div className="chips" role="group" aria-label="Filter by status">
        {['All', ...BUG_STATUSES].map((s) => (
          <button key={s} className={`chip ${status === s ? 'on' : ''}`} aria-pressed={status === s} onClick={() => { setStatus(s); setLimit(PAGE); }}>
            {s} <span>{s === 'All' ? base.length : counts[s]}</span>
          </button>
        ))}
      </div>

      <div className="toolbar card">
        <div className="search">
          <Icon name="search" />
          <label htmlFor="bug-q" className="sr">Search bugs</label>
          <input id="bug-q" type="search" placeholder="Search ID, title, module, steps, notes…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
        </div>
        <Field label="Module" id="bf-mod"><Select id="bf-mod" value={mod} onChange={setMod} options={[{ value: 'All', label: 'All modules' }, ...modules.map((m) => ({ value: m.code, label: m.code }))]} /></Field>
        <Field label="Severity" id="bf-sev"><Select id="bf-sev" value={sev} onChange={setSev} options={['All', ...SEVERITIES]} /></Field>
        <Field label="Assigned to" id="bf-who"><Select id="bf-who" value={who} onChange={setWho} options={whoOptions} /></Field>
        <div className="toolbar-end">
          <span className="muted">{list.length} bug{list.length === 1 ? '' : 's'}</span>
          {filtered && <button className="link" onClick={() => { setMod('All'); setSev('All'); setWho('All'); setQ(''); }}>Clear filters</button>}
        </div>
      </div>

      {view === 'cards' ? (
        list.length === 0 ? <div className="card"><Empty title={status === 'Open' ? 'No open bugs here' : 'No bugs match'}>Try another status or clear the filters.</Empty></div> : (
          <>
            <div className="bug-list">
              {list.slice(0, limit).map((b) => <BugCard key={b.id} bug={b} team={team} user={user} onOpen={() => openBug(b.id)} openTest={openTest} onUpdate={update} />)}
            </div>
            {list.length > limit && <button className="btn block" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, list.length - limit)} more of {list.length - limit}</button>}
          </>
        )
      ) : (
        <Board list={base} team={team} openBug={openBug} onUpdate={update} />
      )}
    </div>
  );
}

function BugCard({ bug, team, user, onOpen, openTest, onUpdate }) {
  const [more, setMore] = useState(false);
  const closable = canClose(bug, user);
  const statusOpts = BUG_STATUSES.map((s) => ({ value: s, label: s, disabled: s === 'Closed' && !closable && bug.status !== 'Closed' }));
  const long = (bug.steps + bug.expected + bug.actual).length > 260;
  return (
    <article className={`bcard sev-${bug.severity.toLowerCase()}`}>
      <header className="bcard-head">
        <button className="bcard-title" onClick={onOpen}>
          <span className="mono strong">{bug.id}</span>
          <span className="t">{bug.title}</span>
        </button>
        <div className="bcard-tags"><ModPill code={bug.module} /><Pill>{bug.severity}</Pill><Pill>{bug.status}</Pill></div>
      </header>

      <div className={`bcard-body ${more || !long ? 'open' : ''}`}>
        <div><h4>Steps to reproduce</h4><p className="pre">{bug.steps || '—'}</p></div>
        <div><h4>Expected</h4><p className="pre">{bug.expected || '—'}</p></div>
        <div><h4>Actual</h4><p className="pre">{bug.actual || '—'}</p></div>
        {bug.notes && <div className="wide"><h4>Notes</h4><p className="pre">{bug.notes}</p></div>}
      </div>
      {long && <button className="link small more" onClick={() => setMore((m) => !m)}>{more ? 'Show less' : 'Show full details'}</button>}

      <footer className="bcard-foot">
        <div className="bcard-meta muted small">
          <span>Reported by {memberName(team, bug.reporter)} · {fmtDate(bug.createdAt)}</span>
          {bug.testCaseId && <button className="link small" onClick={() => openTest(bug.testCaseId)}>{bug.testCaseId}</button>}
          <span>Updated {timeAgo(bug.updatedAt)}</span>
        </div>
        <div className="bcard-actions">
          <div className="inline-field">
            <Avatar name={memberName(team, bug.assignee)} size={30} />
            <label htmlFor={`as-${bug.id}`} className="sr">Assign {bug.id}</label>
            <select id={`as-${bug.id}`} value={bug.assignee} onChange={(e) => {
              const dev = team.find((m) => m.id === e.target.value);
              onUpdate(bug, { assignee: e.target.value }, e.target.value ? `${bug.id} assigned to ${dev?.name}` : `${bug.id} unassigned`);
            }}>
              {developerOptions(team).map((o) => <option key={o.value} value={o.value}>{o.value ? `Assign: ${o.label}` : 'Assign developer…'}</option>)}
            </select>
          </div>
          <label htmlFor={`st-${bug.id}`} className="sr">Status of {bug.id}</label>
          <select id={`st-${bug.id}`} className="status-sel" value={bug.status} onChange={(e) => onUpdate(bug, { status: e.target.value }, `${bug.id} → ${e.target.value}`)}>
            {statusOpts.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.disabled ? `${o.label} (assignee only)` : o.label}</option>)}
          </select>
          <button className="btn sm" onClick={onOpen}>Open</button>
        </div>
      </footer>
    </article>
  );
}

function Board({ list, team, openBug, onUpdate }) {
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  return (
    <div className="board" role="list">
      {BUG_STATUSES.map((s) => {
        const items = list.filter((b) => b.status === s);
        return (
          <section key={s} className={`col ${over === s ? 'over' : ''}`} role="listitem" aria-label={`${s}, ${items.length} bugs`}
            onDragOver={(e) => { e.preventDefault(); setOver(s); }}
            onDragLeave={() => setOver((o) => (o === s ? null : o))}
            onDrop={(e) => { e.preventDefault(); setOver(null); const b = list.find((x) => x.id === dragId); if (b && b.status !== s) onUpdate(b, { status: s }, `${b.id} → ${s}`); setDragId(null); }}>
            <header className="col-head"><Pill>{s}</Pill><span className="num">{items.length}</span></header>
            <div className="col-body">
              {items.length === 0 && <div className="col-empty">Drop bugs here</div>}
              {items.map((b) => (
                <article key={b.id} className={`bug-card sev-${b.severity.toLowerCase()} ${dragId === b.id ? 'dragging' : ''}`} draggable
                  onDragStart={(e) => { setDragId(b.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', b.id); }}
                  onDragEnd={() => { setDragId(null); setOver(null); }}>
                  <button className="bug-open" onClick={() => openBug(b.id)} aria-label={`Open ${b.id}: ${b.title}`}>
                    <div className="bug-top"><span className="mono strong">{b.id}</span><Pill>{b.severity}</Pill></div>
                    <p>{b.title}</p>
                    <div className="bug-meta">
                      <ModPill code={b.module} />
                      <span className="assignee"><Avatar name={memberName(team, b.assignee)} size={24} /><span className="small">{memberName(team, b.assignee)}</span></span>
                    </div>
                  </button>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
