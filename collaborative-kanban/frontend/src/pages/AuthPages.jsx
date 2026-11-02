import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { errorInfo } from '../services/api';

const DEMO = [
  ['Rahul — Org admin (ABC)', 'rahul@abc.test'], ['Priya — Tenant admin (Hyderabad)', 'priya@abc.test'], ['Arjun — Member (Hyderabad)', 'arjun@abc.test'],
  ['Sneha — Tenant admin (Bangalore)', 'sneha@abc.test'], ['Kiran — Member (XYZ Mumbai)', 'kiran@xyz.test'],
];

function Frame({ title, subtitle, children, footer }) {
  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-[#0d3b41] p-12 text-white lg:flex lg:flex-col lg:justify-between" aria-hidden>
        <span className="font-display text-xl font-bold">Branchboard</span>
        <div className="relative z-10 max-w-md">
          <h2 className="text-4xl font-bold leading-tight">One board per branch. Everyone sees the move the moment it happens.</h2>
          <p className="mt-4 text-white/70">Hyderabad never sees Bangalore’s work. Each branch gets its own people, boards and history — kept apart by the server, not by the UI.</p>
        </div>
        <div className="absolute -right-10 bottom-0 flex items-end gap-3 opacity-90">
          {[[7, 'bg-white/10'], [11, 'bg-white/15'], [5, 'bg-signal'], [9, 'bg-white/10']].map(([n, c], i) => (
            <div key={i} className="w-28 space-y-2">{Array.from({ length: n }).map((_, j) => <div key={j} className={`h-14 rounded-xl ${c} ${j % 3 === 0 ? 'h-20' : ''}`} />)}</div>
          ))}
        </div>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="mb-6 mt-1 text-sm text-mute">{subtitle}</p>
          {children}
          <p className="mt-6 text-center text-sm text-mute">{footer}</p>
        </div>
      </section>
    </div>
  );
}

function useAuthForm(action) {
  const nav = useNavigate();
  const loc = useLocation();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (fn) => {
    setError(null); setBusy(true);
    try { await fn(); nav(loc.state?.from || '/', { replace: true }); }
    catch (e) { const i = errorInfo(e); setError(i.details?.length ? i.details.map((d) => `${d.path}: ${d.message}`).join(' · ') : i.message); }
    finally { setBusy(false); }
  };
  return { error, busy, submit, action };
}

export function LoginPage() {
  const { user, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { error, busy, submit } = useAuthForm();
  if (user) return <Navigate to="/" replace />;
  return (
    <Frame title="Welcome back" subtitle="Log in to your branch’s board." footer={<>New here? <Link className="font-semibold text-brand underline" to="/register">Create an account</Link></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(() => login(email, password)); }} noValidate>
        <div><label className="label" htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div><label className="label" htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">{error}</p>}
        <button className="btn-primary w-full" disabled={busy || !email || !password}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Log in</button>
      </form>
      {import.meta.env.DEV && (
        <details className="mt-6 rounded-xl border border-line bg-surface p-3 text-sm">
          <summary className="cursor-pointer font-semibold">Demo accounts (development only)</summary>
          <p className="mt-2 text-xs text-mute">Password for all: <code className="rounded bg-sunken px-1">Password123!</code></p>
          <ul className="mt-2 space-y-1">{DEMO.map(([label, em]) => (
            <li key={em}><button type="button" className="w-full rounded-md px-2 py-1 text-left hover:bg-sunken" onClick={() => { setEmail(em); setPassword('Password123!'); }}>{label}</button></li>))}</ul>
        </details>
      )}
    </Frame>
  );
}

export function RegisterPage() {
  const { user, register } = useAuth();
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '' });
  const [localErr, setLocalErr] = useState(null);
  const { error, busy, submit } = useAuthForm();
  if (user) return <Navigate to="/" replace />;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const onSubmit = (e) => {
    e.preventDefault();
    if (f.password.length < 8) return setLocalErr('Password must be at least 8 characters.');
    if (f.password !== f.confirm) return setLocalErr('Passwords do not match.');
    setLocalErr(null);
    submit(() => register(f.name, f.email, f.password));
  };
  return (
    <Frame title="Create your account" subtitle="You’ll be added to a branch by an administrator, or you can create an organization." footer={<>Already registered? <Link className="font-semibold text-brand underline" to="/login">Log in</Link></>}>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <div><label className="label" htmlFor="name">Full name</label><input id="name" autoComplete="name" className="field" value={f.name} onChange={set('name')} required /></div>
        <div><label className="label" htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" className="field" value={f.email} onChange={set('email')} required /></div>
        <div><label className="label" htmlFor="password">Password</label><input id="password" type="password" autoComplete="new-password" className="field" value={f.password} onChange={set('password')} required /></div>
        <div><label className="label" htmlFor="confirm">Confirm password</label><input id="confirm" type="password" autoComplete="new-password" className="field" value={f.confirm} onChange={set('confirm')} required /></div>
        {(localErr || error) && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">{localErr || error}</p>}
        <button className="btn-primary w-full" disabled={busy || !f.name || !f.email || !f.password}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Create account</button>
      </form>
    </Frame>
  );
}
