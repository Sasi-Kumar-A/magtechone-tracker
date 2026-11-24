import { api } from '../lib/api.js';
import { useEffect, useState } from 'react';
import { useTracker } from '../store.jsx';
import { Avatar, Field, Icon, Modal, Pill, Select } from '../components/ui.jsx';
import { DEFAULT_PASSWORD, ROLES, usernameFromName } from '../lib/rules.js';

const GH = api.kind === 'github';
const blank = { id: '', name: '', email: '', role: 'QA', github: '', newPassword: DEFAULT_PASSWORD };

export default function Team() {
  const { team, bugs, testcases, user, actions } = useTracker();
  const isLead = user?.role === 'Lead';
  const [editing, setEditing] = useState(null); // member draft
  const [isNew, setIsNew] = useState(false);
  const [removing, setRemoving] = useState(null);

  const stats = (id) => ({
    open: bugs.filter((b) => b.assignee === id && b.status !== 'Closed').length,
    reported: bugs.filter((b) => b.reporter === id).length,
    tested: testcases.filter((t) => t.testedBy === id).length,
  });
  const inUse = (id) => bugs.some((b) => b.assignee === id || b.reporter === id);

  const save = async (draft) => {
    const others = team.filter((m) => m.id !== (isNew ? '__new' : editing.originalId));
    const list = isNew ? [...team, draft] : team.map((m) => (m.id === editing.originalId ? draft : m));
    if (others.some((m) => m.id === draft.id.trim().toLowerCase())) return 'That username is already taken.';
    const r = await actions.saveTeam(list);
    if (r) setEditing(null);
    return r ? '' : null;
  };

  const grouped = ROLES.map((r) => ({ role: r, members: team.filter((m) => m.role === r) }));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <p className="muted">{team.length} people. {isLead ? (GH ? 'As a Lead you add people, set their role and GitHub username. Saving invites them to the data repo; they sign in with their own GitHub token.' : `As a Lead you add people and set their role. New members sign in with their username and the default password ${DEFAULT_PASSWORD}.`) : 'Only a Lead can change the team.'}</p>
        </div>
        {isLead && <button className="btn primary" onClick={() => { setIsNew(true); setEditing({ ...blank }); }}><Icon name="plus" /> Add member</button>}
      </div>

      {grouped.map((g) => g.members.length > 0 && (
        <section key={g.role} className="team-group">
          <h2>{g.role === 'QA' ? 'QA engineers' : g.role === 'Lead' ? 'Leads' : 'Developers'} <span className="muted">{g.members.length}</span></h2>
          <div className="team-grid">
            {g.members.map((m) => {
              const s = stats(m.id);
              return (
                <article key={m.id} className="member">
                  <div className="member-top">
                    <Avatar name={m.name} size={44} />
                    <div className="member-id">
                      <strong>{m.name}{m.id === user?.id && <span className="you">You</span>}</strong>
                      <span className="muted small">@{m.id}{m.email ? ` · ${m.email}` : ''}</span>
                    </div>
                    <Pill>{m.role}</Pill>
                  </div>
                  <dl className="member-stats">
                    <div><dt>Open bugs</dt><dd>{s.open}</dd></div>
                    <div><dt>Reported</dt><dd>{s.reported}</dd></div>
                    <div><dt>Tests run</dt><dd>{s.tested}</dd></div>
                  </dl>
                  <div className="member-foot">
                    <span className="muted small">{m.github ? `GitHub @${m.github}` : m.role === 'Developer' ? 'No GitHub username: no notifications' : ''}</span>
                    {isLead && (
                      <div className="row gap">
                        <button className="link" onClick={() => { setIsNew(false); setEditing({ ...m, newPassword: '', originalId: m.id }); }}>Edit</button>
                        {m.id === user?.id ? null : inUse(m.id) ? <span className="in-use" title="Has bugs assigned or reported">Has bugs</span> : <button className="link danger" onClick={() => setRemoving(m)}>Remove</button>}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {editing && <MemberForm draft={editing} isNew={isNew} onClose={() => setEditing(null)} onSave={save} />}
      {removing && (
        <Modal title={`Remove ${removing.name}?`} onClose={() => setRemoving(null)}
          footer={<><button className="btn" onClick={() => setRemoving(null)}>Cancel</button><button className="btn danger" onClick={async () => { await actions.saveTeam(team.filter((m) => m.id !== removing.id)); setRemoving(null); }}>Remove</button></>}>
          <p>{removing.name} will no longer be able to sign in.</p>
        </Modal>
      )}
    </div>
  );
}

function MemberForm({ draft, isNew, onClose, onSave }) {
  const [f, setF] = useState(draft);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [idTouched, setIdTouched] = useState(!isNew);
  useEffect(() => setF(draft), [draft]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: typeof v === 'string' ? v : v.target.value }));
  const setName = (e) => {
    const name = e.target.value;
    setF((x) => ({ ...x, name, id: idTouched ? x.id : usernameFromName(name) }));
  };
  const validId = /^[a-z0-9._-]{3,30}$/.test(f.id.trim().toLowerCase());
  const pwOk = GH ? /^[A-Za-z0-9-]{1,39}$/.test(String(f.github).replace(/^@/, '').trim()) : isNew ? f.newPassword.length >= 8 : !f.newPassword || f.newPassword.length >= 8;
  const ok = f.name.trim() && validId && pwOk && (!f.email || /^\S+@\S+\.\S+$/.test(f.email));

  const submit = async (e) => {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    const { originalId, ...clean } = f;
    const res = await onSave({ ...clean, id: clean.id.trim().toLowerCase(), newPassword: clean.newPassword || undefined });
    setBusy(false);
    if (res) setErr(res);
  };

  return (
    <Modal title={isNew ? 'Add team member' : `Edit ${draft.name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" form="member-form" disabled={!ok || busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="member-form" className="form" onSubmit={submit}>
        <Field label="Full name *" id="m-name"><input id="m-name" value={f.name} onChange={setName} autoFocus /></Field>
        <Field label="Username *" id="m-id" hint={!f.id || validId ? (isNew ? 'Filled in from the name. They sign in with this or their email.' : 'Usernames can\'t be changed.') : 'Use 3-30 lowercase letters, numbers, dot or dash'}>
          <input id="m-id" value={f.id} onChange={(e) => { setIdTouched(true); set('id')(e); }} disabled={!isNew} autoCapitalize="none" />
        </Field>
        <Field label="Email" id="m-email"><input id="m-email" type="text" inputMode="email" value={f.email} onChange={set('email')} placeholder="name@company.com" /></Field>
        <Field label="Role" id="m-role"><Select id="m-role" value={f.role} onChange={set('role')} options={ROLES} /></Field>
        <Field label={GH ? 'GitHub username *' : 'GitHub username'} id="m-gh" hint={GH ? 'Required. Saving sends them a GitHub invitation to the data repo; they accept it, then sign in with their own token.' : 'Developers need this to get bug notifications.'}><input id="m-gh" value={f.github} onChange={set('github')} placeholder="username" /></Field>
        {!GH && <Field label={isNew ? 'Starting password *' : 'New password'} id="m-pw" hint={isNew ? `Default is ${DEFAULT_PASSWORD}. Ask them to change it in Settings after first sign-in.` : 'Leave empty to keep their current password.'}>
          <div className="row gap">
            <input id="m-pw" type="text" value={f.newPassword} onChange={set('newPassword')} autoComplete="new-password" />
            {!isNew && <button type="button" className="btn sm" onClick={() => setF((x) => ({ ...x, newPassword: DEFAULT_PASSWORD }))}>Reset to default</button>}
          </div>
        </Field>}
        {err && <p className="error-text wide" role="alert">{err}</p>}
      </form>
    </Modal>
  );
}
