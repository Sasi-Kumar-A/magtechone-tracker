import { useState } from 'react';
import { useTracker } from '../store.jsx';
import { Icon } from '../components/ui.jsx';
import { api } from '../lib/api.js';

const GH = api.kind === 'github';
const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=MagtechOne%20Tracker';

export default function Login() {
  const { login, mode, effective, setTheme } = useTracker();
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if ((!GH && !name.trim()) || !pw) { setErr(GH ? 'Paste your GitHub token.' : 'Enter your username or email and your password.'); return; }
    setBusy(true);
    setErr('');
    try {
      await login(name.trim(), pw);
    } catch (ex) {
      setErr(ex.message || 'Could not sign in.');
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <button className="icon-btn theme-corner" onClick={() => setTheme(effective === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${effective === 'dark' ? 'light' : 'dark'} theme`}>
        <Icon name={effective === 'dark' ? 'sun' : 'moon'} />
      </button>
      <section className="login-art" aria-hidden="true">
        <div className="login-brand"><span className="logo">M</span><span>MagtechOne <b>Tracker</b></span></div>
        <h1>Test it. Log it. Fix it. Together.</h1>
        <p>One shared place for the QA team and developers: test cases, results and bugs for every module.</p>
        <ul className="login-points">
          <li><Icon name="check" /> Record Pass / Fail with remarks</li>
          <li><Icon name="check" /> Raise bugs straight from a failed test</li>
          <li><Icon name="check" /> Developers get notified, only they can close</li>
        </ul>
      </section>
      <section className="login-card">
        <form onSubmit={submit} className="login-form" noValidate>
          <h2>Sign in</h2>
          <p className="muted">{GH ? 'Use your tracker username and your own GitHub token. Your saves are recorded under your GitHub name.' : 'Use the username or email your QA lead gave you.'}</p>
          <div className="field">
            <label htmlFor="login-name">Username or email{GH ? ' (optional if your Lead linked your GitHub account)' : ''}</label>
            <input id="login-name" autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label htmlFor="login-pw">{GH ? 'GitHub token' : 'Password'}</label>
            <div className="pw">
              <input id="login-pw" type={show ? 'text' : 'password'} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
              <button type="button" className="link" onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</button>
            </div>
          </div>
          {err && <p className="error-text" role="alert">{err}</p>}
          <button className="btn primary block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          {GH ? (
            <p className="muted small">No token yet? <a href={TOKEN_URL} target="_blank" rel="noreferrer">Create one on GitHub</a> (classic token, tick <b>repo</b>), then accept the invitation e-mail to the data repo. The token stays in this browser only.</p>
          ) : <p className="muted small">Forgot your password? Ask your QA lead to set a new one on the Team page.</p>}
          {mode === 'demo' && (
            <div className="demo-hint">
              <strong>Preview accounts</strong> (password <code>tester12345</code>):
              <div className="demo-users">
                {[['tester', 'Lead'], ['qa.engineer.1', 'QA'], ['developer.1', 'Developer']].map(([u, l]) => (
                  <button type="button" key={u} className="chip" onClick={() => { setName(u); setPw('tester12345'); }}>{u} <span>{l}</span></button>
                ))}
              </div>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
