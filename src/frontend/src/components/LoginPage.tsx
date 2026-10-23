import { useState, type FormEvent } from 'react';

type Props = { onLogin: (username: string, password: string) => boolean };

export function LoginPage({ onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(onLogin(username, password) ? '' : 'Incorrect username or password.');
  }

  return <main className="login-page">
    <section className="login-card">
      <img src="/SOPBox_Logo.jpeg" alt="SOPBox" className="login-logo" />
      <h1>Welcome to SOPBox</h1>
      <p>Sign in to manage your receiving checks.</p>
      <form onSubmit={submit} className="login-form">
        <label className="field"><span>Username</span><input autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter username" /></label>
        <label className="field"><span>Password</span><input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter password" /></label>
        {error && <div className="notice warn" role="alert">{error}</div>}
        <button className="primary-btn login-submit" type="submit">Sign in →</button>
      </form>
      <div className="login-demo">
        <strong>Hackathon demo accounts (not secure authentication)</strong>
        <p>Admin: <code>admin</code> / <code>SopBoxDemo2026!</code></p>
        <p>Staff: <code>staff</code> / <code>StaffDemo2026!</code></p>
        <small>Login and user accounts are frontend-only. A real backend authentication service is required before deployment.</small>
      </div>
    </section>
  </main>;
}
