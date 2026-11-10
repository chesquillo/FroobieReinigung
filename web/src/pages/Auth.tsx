import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, type User } from '../api';
import { LangSwitcher, useAuth, useErrorText } from '../components';

function useNext() {
  const [params] = useSearchParams();
  const next = params.get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function AuthShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
          <LangSwitcher />
        </div>
        <img src="/logo.jpg" alt="Froobie – Taste the honesty" className="auth-logo" />
        <p className="center" style={{ fontWeight: 800, color: 'var(--green-700)', marginTop: 0 }}>
          {t('appTagline')}
        </p>
        <div className="card accent">{children}</div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const next = useNext();
  const navigate = useNavigate();
  const errText = useErrorText();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={next} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setUser(await api.post<User>('/auth/login', { username, password }));
      navigate(next, { replace: true });
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <h1>{t('login')}</h1>
      {next.startsWith('/m/') && <div className="alert info">📱 {t('scanHint')}</div>}
      {error && <div className="alert error">{error}</div>}
      <form onSubmit={submit}>
        <label className="field">
          <span>{t('usernameOrEmail')}</span>
          <input autoComplete="username" autoCapitalize="none" required value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('password')}</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="btn block big" disabled={busy}>
          {t('login')}
        </button>
      </form>
      <p className="center small mt">
        {t('noAccount')} <Link to={`/register?next=${encodeURIComponent(next)}`}>{t('register')}</Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { t, i18n } = useTranslation();
  const { user, setUser } = useAuth();
  const next = useNext();
  const navigate = useNavigate();
  const errText = useErrorText();
  const [form, setForm] = useState({ username: '', fullName: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={next} replace />;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setUser(await api.post<User>('/auth/register', { ...form, language: i18n.language }));
      navigate(next, { replace: true });
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <h1>{t('createAccount')}</h1>
      {error && <div className="alert error">{error}</div>}
      <form onSubmit={submit}>
        <label className="field">
          <span>{t('fullName')}</span>
          <input autoComplete="name" required minLength={2} value={form.fullName} onChange={set('fullName')} />
        </label>
        <label className="field">
          <span>
            {t('username')} <small>· {t('usernameHint')}</small>
          </span>
          <input autoComplete="username" autoCapitalize="none" required pattern="[A-Za-z0-9._\-]{3,30}" value={form.username} onChange={set('username')} />
        </label>
        <label className="field">
          <span>{t('gmail')}</span>
          <input type="email" autoComplete="email" placeholder="name@gmail.com" required pattern=".+@(gmail|googlemail)\.com" value={form.email} onChange={set('email')} />
        </label>
        <label className="field">
          <span>
            {t('password')} <small>· {t('passwordHint')}</small>
          </span>
          <input type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={set('password')} />
        </label>
        <button className="btn block big" disabled={busy}>
          {t('register')}
        </button>
      </form>
      <p className="center small mt">
        {t('haveAccount')} <Link to={`/login?next=${encodeURIComponent(next)}`}>{t('login')}</Link>
      </p>
    </AuthShell>
  );
}
