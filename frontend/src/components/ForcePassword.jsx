import { useState } from 'react';
import { useTracker } from '../store.jsx';
import { DEFAULT_PASSWORD } from '../lib/rules.js';

/** Shown after sign-in while the person still has the password the Lead gave them. */
export default function ForcePassword() {
  const { user, actions, reload, logout } = useTracker();
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = next.length >= 8 && next === again && next !== DEFAULT_PASSWORD;
  const submit = async (e) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    const r = await actions.changePassword(DEFAULT_PASSWORD, next);
    setBusy(false);
    if (r) reload(true);
  };
  return (
    <div className="login-wrap">
      <section className="login-card" style={{ margin: 'auto' }}>
        <form className="login-form" onSubmit={submit} noValidate>
          <h2>Set your own password</h2>
          <p className="muted">Welcome {user?.name}. You signed in with the password your Lead gave you. Choose your own before you continue.</p>
          <div className="field"><label htmlFor="fp-new">New password</label><input id="fp-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} autoFocus /></div>
          <div className="field"><label htmlFor="fp-again">Repeat new password</label><input id="fp-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></div>
          <p className="muted small">At least 8 characters, and not {DEFAULT_PASSWORD}.{again && next !== again ? ' Passwords do not match.' : ''}</p>
          <button className="btn primary block" disabled={!ok || busy}>{busy ? 'Saving…' : 'Save and continue'}</button>
          <button type="button" className="link" onClick={logout}>Sign out</button>
        </form>
      </section>
    </div>
  );
}
