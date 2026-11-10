import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, type Incident, type Machine, type MaintenanceLog, type Task, type User } from '../api';
import { IncidentForm, Loading, Modal, SignaturePad, StatusBadge, useAuth, useErrorText, useLoad, useToast } from '../components';
import { formatDate, formatDateTime, LANGUAGES } from '../i18n';

// ---------- Inicio: máquinas de hoy ----------
export function HomePage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { data } = useLoad<{ date: string; machines: Machine[] }>('/machines', [i18n.language]);
  if (!data) return <Loading />;
  const scheduled = data.machines.filter((m) => m.tasks!.length > 0);
  const others = data.machines.filter((m) => m.tasks!.length === 0);
  const strictToday = scheduled.some((m) => m.tasks!.some((tk) => tk.strict));

  return (
    <>
      <h1>{t('hello', { name: user!.fullName.split(' ')[0] })} 👋</h1>
      <p className="muted" style={{ marginTop: -6, textTransform: 'capitalize' }}>
        {formatDate(data.date, i18n.language)}
      </p>
      {strictToday && <div className="alert info">⭐ {t('strictInfo')}</div>}
      <div className="card warn small">📱 {t('scanHint')}</div>
      <div className="grid">
        {scheduled.map((m) => (
          <MachineCard key={m.id} m={m} />
        ))}
      </div>
      {others.length > 0 && (
        <>
          <h3 className="mt muted">{t('notScheduledToday')}</h3>
          <div className="grid">
            {others.map((m) => (
              <MachineCard key={m.id} m={m} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function MachineCard({ m }: { m: Machine }) {
  const { t } = useTranslation();
  const tasks = m.tasks ?? [];
  const allDone = tasks.length > 0 && tasks.every((tk) => tk.done);
  return (
    <Link to={`/machine/${m.id}`} className={`card machine-card ${allDone ? 'accent' : tasks.length ? 'warn' : ''}`}>
      {m.photoUrl ? <img src={m.photoUrl} alt="" className="thumb" /> : <span className="thumb" />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ gap: 6 }}>
          <span className="num-chip">{m.number}</span>
          <strong>{m.name}</strong>
        </div>
        <div className="row mt" style={{ gap: 6, marginTop: 6 }}>
          {tasks.length === 0 ? (
            <span className="badge grey">—</span>
          ) : allDone ? (
            <span className="badge">✓ {t('done')}</span>
          ) : (
            <span className="badge yellow">⏳ {t('pending')}</span>
          )}
          {tasks.some((tk) => tk.strict) && <span className="badge blue">⭐ {t('strictDay')}</span>}
          {!!m.openIncidents && <span className="badge red">⚠ {m.openIncidents}</span>}
        </div>
      </div>
    </Link>
  );
}

// ---------- Escaneo QR → máquina ----------
export function ScanPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [notFound, setNotFound] = useState(false);
  useEffect(() => {
    api
      .get<{ id: number }>(`/machines/by-qr/${encodeURIComponent(token!)}`)
      .then(({ id }) => navigate(`/machine/${id}`, { replace: true }))
      .catch(() => setNotFound(true));
  }, [token, navigate]);
  return (
    <div className="auth-wrap">
      <img src="/logo.jpg" alt="Froobie" className="auth-logo" />
      {notFound ? (
        <div className="card danger">
          <p>{t('machineNotFound')}</p>
          <Link to="/" className="btn block">
            {t('back')}
          </Link>
        </div>
      ) : (
        <Loading />
      )}
    </div>
  );
}

// ---------- Ficha de máquina + limpieza ----------
interface MachineDetail {
  machine: Machine;
  date: string;
  tasks: Task[];
  openIncidents: Incident[];
  maintenance: MaintenanceLog[];
  recentRecords: { id: number; date: string; completedAt: string; status: string; wasStrict: boolean; user: string }[];
}

export function MachinePage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { data, error, reload } = useLoad<MachineDetail>(`/machines/${id}`, [i18n.language]);
  const [active, setActive] = useState<Task | null>(null);

  if (error) return <div className="alert error">{t('machineNotFound')}</div>;
  if (!data) return <Loading />;
  const m = data.machine;

  if (active) {
    return (
      <CleaningFlow
        machine={m}
        task={active}
        onCancel={() => setActive(null)}
        onDone={() => {
          setActive(null);
          reload();
        }}
      />
    );
  }

  return (
    <>
      <Link to="/" className="btn ghost small">
        ← {t('back')}
      </Link>
      <div className="card">
        {m.photoUrl && <img src={m.photoUrl} alt={m.name} className="machine-hero" />}
        <div className="row between mt">
          <div className="row">
            <span className="num-chip">{m.number}</span>
            <h1 style={{ margin: 0 }}>{m.name}</h1>
          </div>
          <StatusBadge status={m.status} />
        </div>
        <dl className="specs mt">
          {m.model && (
            <>
              <dt>{t('model')}</dt>
              <dd>{m.model}</dd>
            </>
          )}
          {m.serialNumber && (
            <>
              <dt>{t('serialNumber')}</dt>
              <dd>{m.serialNumber}</dd>
            </>
          )}
          {m.manufacturer && (
            <>
              <dt>{t('manufacturer')}</dt>
              <dd>{m.manufacturer}</dd>
            </>
          )}
          {m.location && (
            <>
              <dt>{t('location')}</dt>
              <dd>{m.location}</dd>
            </>
          )}
        </dl>
        {user?.role === 'ADMIN' && (
          <Link to={`/admin/machines/${m.id}`} className="btn secondary small mt">
            ⚙ {t('edit')}
          </Link>
        )}
      </div>

      <h2>
        {t('today')} · <span style={{ textTransform: 'capitalize' }}>{formatDate(data.date, i18n.language)}</span>
      </h2>
      {data.tasks.length === 0 && <div className="card muted">{t('notScheduledToday')}</div>}
      {data.tasks.map((tk) => (
        <div key={tk.planId} className={`card ${tk.done ? 'accent' : 'warn'}`}>
          <div className="row between">
            <strong>{tk.planName}</strong>
            {tk.strict && <span className="badge blue">⭐ {t('strictDay')}</span>}
          </div>
          <p className="muted small">{t('stepsDone', { done: tk.done ? tk.steps.length : 0, total: tk.steps.length })}</p>
          {tk.done ? (
            <div className="row between">
              <span className="badge">✓ {t('doneBy', { name: tk.done.by, time: tk.done.time })}</span>
              <Link to={`/record/${tk.done.recordId}`} className="small">
                →
              </Link>
            </div>
          ) : (
            <button className="btn block big" onClick={() => setActive(tk)}>
              🧽 {t('startCleaning')}
            </button>
          )}
        </div>
      ))}

      {data.openIncidents.length > 0 && (
        <>
          <h2 className="mt">⚠ {t('openIncidents')}</h2>
          {data.openIncidents.map((inc) => (
            <div key={inc.id} className="card danger row" style={{ alignItems: 'flex-start' }}>
              <a href={inc.photoUrl} target="_blank" rel="noreferrer">
                <img src={inc.photoUrl} alt="" style={{ width: 70, height: 70, objectFit: 'cover', borderRadius: 8 }} />
              </a>
              <div style={{ flex: 1 }}>
                <span className={`badge ${inc.severity === 'HIGH' ? 'red' : 'yellow'}`}>{t(inc.severity)}</span>
                <p style={{ margin: '6px 0' }}>{inc.description}</p>
                <span className="muted small">
                  {inc.user?.fullName} · {formatDateTime(inc.createdAt, i18n.language)}
                </span>
              </div>
            </div>
          ))}
        </>
      )}

      <h2 className="mt">{t('recentCleanings')}</h2>
      {data.recentRecords.length === 0 ? (
        <p className="muted">{t('noRecords')}</p>
      ) : (
        <div className="card table-wrap">
          <table>
            <tbody>
              {data.recentRecords.map((r) => (
                <tr key={r.id}>
                  <td>{formatDateTime(r.completedAt, i18n.language)}</td>
                  <td>{r.user}</td>
                  <td>
                    <StatusBadge status={r.status} /> {r.wasStrict && '⭐'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.maintenance.length > 0 && (
        <>
          <h2 className="mt">{t('maintenanceHistory')}</h2>
          <div className="card table-wrap">
            <table>
              <tbody>
                {data.maintenance.map((l) => (
                  <tr key={l.id}>
                    <td>{formatDate(l.date, i18n.language)}</td>
                    <td>
                      <span className="badge yellow">{t(l.type)}</span>
                    </td>
                    <td>{l.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function CleaningFlow({ machine, task, onCancel, onDone }: { machine: Machine; task: Task; onCancel: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const errText = useErrorText();
  const [startedAt] = useState(() => new Date().toISOString());
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [comment, setComment] = useState('');
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [showIncident, setShowIncident] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const doneCount = task.steps.filter((s) => checked[s.id]).length;
  const allChecked = doneCount === task.steps.length;

  const submit = async () => {
    setError('');
    if (!allChecked && !comment.trim() && incidents.length === 0) return setError(t('needCommentForUnchecked'));
    if (!signature) return setError(t('errors.SIGNATURE_REQUIRED'));
    setBusy(true);
    try {
      await api.post('/records', {
        machineId: machine.id,
        planId: task.planId,
        startedAt,
        steps: task.steps.map((s) => ({ stepId: s.id, checked: !!checked[s.id] })),
        comment,
        signature,
        incidentIds: incidents.map((i) => i.id),
      });
      toast('✅ ' + t('cleaningSaved'));
      onDone();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="btn ghost small" onClick={onCancel}>
        ← {t('cancel')}
      </button>
      <div className="row" style={{ margin: '6px 0 10px' }}>
        <span className="num-chip">{machine.number}</span>
        <h1 style={{ margin: 0 }}>{machine.name}</h1>
      </div>
      {task.strict && <div className="alert info">⭐ {t('strictInfo')}</div>}

      <div className="row between">
        <h2 style={{ margin: 0 }}>{t('checklist')}</h2>
        <span className="muted small">{t('stepsDone', { done: doneCount, total: task.steps.length })}</span>
      </div>
      <div className="progress" style={{ margin: '8px 0 12px' }}>
        <div style={{ width: `${(doneCount / task.steps.length) * 100}%` }} />
      </div>
      {task.steps.map((s, i) => (
        <div
          key={s.id}
          role="checkbox"
          aria-checked={!!checked[s.id]}
          tabIndex={0}
          className={`step ${checked[s.id] ? 'checked' : ''} ${s.onlyStrictDays ? 'strict' : ''}`}
          onClick={() => setChecked({ ...checked, [s.id]: !checked[s.id] })}
          onKeyDown={(e) => e.key === ' ' && (e.preventDefault(), setChecked({ ...checked, [s.id]: !checked[s.id] }))}
        >
          <span className="box">{checked[s.id] ? '✓' : ''}</span>
          <div style={{ flex: 1 }}>
            <span className="muted small">{i + 1}. </span>
            {s.text}
            {s.onlyStrictDays && (
              <>
                {' '}
                <span className="badge blue">⭐ {t('extraStep')}</span>
              </>
            )}
          </div>
        </div>
      ))}

      <h2 className="mt">{t('incidents')}</h2>
      {incidents.map((inc) => (
        <div key={inc.id} className="card danger row">
          <img src={inc.photoUrl} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8 }} />
          <div>
            <span className="badge red">{t(inc.severity)}</span> {inc.description}
          </div>
        </div>
      ))}
      <button className="btn yellow block" onClick={() => setShowIncident(true)}>
        ⚠ {t('reportIncident')}
      </button>

      <label className="field mt">
        <span>{t('comment')}</span>
        <textarea placeholder={t('commentPlaceholder')} value={comment} onChange={(e) => setComment(e.target.value)} />
      </label>

      <h2>✍ {t('signature')}</h2>
      <SignaturePad onChange={setSignature} />

      {error && <div className="alert error mt">{error}</div>}
      <button className="btn block big mt" onClick={submit} disabled={busy}>
        ✅ {t('submit')}
      </button>

      {showIncident && (
        <Modal title={t('reportIncident')} onClose={() => setShowIncident(false)}>
          <IncidentForm
            machineId={machine.id}
            onCancel={() => setShowIncident(false)}
            onSaved={(inc) => {
              setIncidents([...incidents, inc]);
              setShowIncident(false);
              toast(t('incidentAdded'));
            }}
          />
        </Modal>
      )}
    </>
  );
}

// ---------- Mis limpiezas ----------
interface RecordRow {
  id: number;
  date: string;
  completedAt: string;
  status: string;
  wasStrict: boolean;
  machine: { number: number; name: string };
  _count: { incidents: number };
}

export function MyRecordsPage() {
  const { t, i18n } = useTranslation();
  const { data } = useLoad<RecordRow[]>('/records/mine');
  if (!data) return <Loading />;
  return (
    <>
      <h1>{t('myCleanings')}</h1>
      {data.length === 0 && <p className="muted">{t('noRecords')}</p>}
      {data.map((r) => (
        <Link key={r.id} to={`/record/${r.id}`} className="card machine-card">
          <span className="num-chip">{r.machine.number}</span>
          <div style={{ flex: 1 }}>
            <strong>{r.machine.name}</strong>
            <div className="muted small">{formatDateTime(r.completedAt, i18n.language)}</div>
          </div>
          <div className="row" style={{ gap: 4 }}>
            {r.wasStrict && <span className="badge blue">⭐</span>}
            {r._count.incidents > 0 && <span className="badge red">⚠ {r._count.incidents}</span>}
            <StatusBadge status={r.status} />
          </div>
        </Link>
      ))}
    </>
  );
}

interface RecordDetail {
  id: number;
  date: string;
  completedAt: string;
  status: string;
  wasStrict: boolean;
  comment: string | null;
  signature: string;
  machine: Machine;
  user: { fullName: string };
  plan: { name: string } | null;
  steps: { id: number; text: string; checked: boolean }[];
  incidents: Incident[];
}

export function RecordPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data } = useLoad<RecordDetail>(`/records/${id}`, [i18n.language]);
  if (!data) return <Loading />;
  return (
    <>
      <button className="btn ghost small" onClick={() => navigate(-1)}>
        ← {t('back')}
      </button>
      <div className="card accent">
        <div className="row between">
          <div className="row">
            <span className="num-chip">{data.machine.number}</span>
            <h1 style={{ margin: 0 }}>{data.machine.name}</h1>
          </div>
          <StatusBadge status={data.status} />
        </div>
        <dl className="specs mt">
          <dt>{t('date')}</dt>
          <dd>{formatDateTime(data.completedAt, i18n.language)}</dd>
          <dt>{t('worker')}</dt>
          <dd>{data.user.fullName}</dd>
          <dt>{t('plan')}</dt>
          <dd>
            {data.plan?.name ?? '—'} {data.wasStrict && <span className="badge blue">⭐ {t('strictDay')}</span>}
          </dd>
        </dl>
      </div>
      <h2>{t('checklist')}</h2>
      {data.steps.map((s) => (
        <div key={s.id} className={`step ${s.checked ? 'checked' : ''}`} style={{ cursor: 'default' }}>
          <span className="box" style={s.checked ? undefined : { borderColor: 'var(--red)', color: 'var(--red)' }}>
            {s.checked ? '✓' : '✕'}
          </span>
          <div>{s.text}</div>
        </div>
      ))}
      {data.comment && (
        <div className="card">
          <strong>{t('comment')}:</strong> {data.comment}
        </div>
      )}
      {data.incidents.map((inc) => (
        <div key={inc.id} className="card danger row">
          <img src={inc.photoUrl} alt="" style={{ width: 70, height: 70, objectFit: 'cover', borderRadius: 8 }} />
          <div>
            <span className="badge red">{t(inc.severity)}</span> {inc.description}
          </div>
        </div>
      ))}
      <div className="card">
        <strong>{t('signature')}</strong>
        <img src={data.signature} alt={t('signature')} style={{ display: 'block', maxWidth: 300, marginTop: 6 }} />
      </div>
    </>
  );
}

// ---------- Perfil ----------
export function ProfilePage() {
  const { t, i18n } = useTranslation();
  const { user, setUser, logout } = useAuth();
  const toast = useToast();
  const errText = useErrorText();
  const navigate = useNavigate();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [error, setError] = useState('');

  const changeLang = async (language: string) => {
    i18n.changeLanguage(language);
    setUser(await api.patch<User>('/auth/me', { language }));
  };

  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.patch('/auth/me', pw);
      setPw({ currentPassword: '', newPassword: '' });
      toast(t('saved'));
    } catch (err) {
      setError(errText(err));
    }
  };

  return (
    <>
      <h1>{t('profile')}</h1>
      <div className="card accent">
        <dl className="specs">
          <dt>{t('fullName')}</dt>
          <dd>{user!.fullName}</dd>
          <dt>{t('username')}</dt>
          <dd>{user!.username}</dd>
          <dt>{t('gmail')}</dt>
          <dd>{user!.email}</dd>
          <dt>{t('role')}</dt>
          <dd>{t(user!.role)}</dd>
        </dl>
      </div>
      <div className="card">
        <h3>{t('language')}</h3>
        <div className="grid2">
          {LANGUAGES.map((l) => (
            <button key={l.code} className={`btn ${i18n.language === l.code ? '' : 'secondary'}`} onClick={() => changeLang(l.code)}>
              {l.flag} {l.label}
            </button>
          ))}
        </div>
      </div>
      <form className="card" onSubmit={changePw}>
        <h3>{t('changePassword')}</h3>
        {error && <div className="alert error">{error}</div>}
        <label className="field">
          <span>{t('currentPassword')}</span>
          <input type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
        </label>
        <label className="field">
          <span>
            {t('newPassword')} <small>· {t('passwordHint')}</small>
          </span>
          <input type="password" autoComplete="new-password" required minLength={8} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
        </label>
        <button className="btn">{t('save')}</button>
      </form>
      <button
        className="btn danger block"
        onClick={async () => {
          await logout();
          navigate('/login');
        }}
      >
        {t('logout')}
      </button>
    </>
  );
}
