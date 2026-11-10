import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, compressImage, type Incident, type Machine, type MaintenanceLog, type Plan, type Task, type User } from '../api';
import { Loading, Modal, StatusBadge, useAuth, useErrorText, useLoad, useToast } from '../components';
import { formatDate, formatDateTime, LANGUAGES, weekdayNames } from '../i18n';

const todayIso = () => new Date().toLocaleDateString('en-CA');

export function AdminLayout() {
  const { t } = useTranslation();
  return (
    <>
      <nav className="subnav">
        <NavLink to="/admin" end>
          📊 {t('dashboard')}
        </NavLink>
        <NavLink to="/admin/machines">🏭 {t('machines')}</NavLink>
        <NavLink to="/admin/incidents">⚠ {t('incidents')}</NavLink>
        <NavLink to="/admin/maintenance">🔧 {t('maintenance')}</NavLink>
        <NavLink to="/admin/reports">📄 {t('reports')}</NavLink>
        <NavLink to="/admin/users">👥 {t('users')}</NavLink>
      </nav>
      <Outlet />
    </>
  );
}

// ---------- Dashboard ----------
interface Dashboard {
  date: string;
  today: { id: number; number: number; name: string; status: string; photoUrl: string | null; tasks: Task[] }[];
  openIncidents: number;
  workers: number;
  week: { scheduled: number; done: number; missed: { date: string; label: string; plan: string; strict: boolean }[] };
  recent: { id: number; date: string; time: string; machine: string; user: string; status: string; wasStrict: boolean }[];
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { data } = useLoad<Dashboard>('/dashboard', [i18n.language]);
  if (!data) return <Loading />;
  const tasks = data.today.flatMap((m) => m.tasks);
  const done = tasks.filter((x) => x.done).length;
  const pct = data.week.scheduled ? Math.round((data.week.done / data.week.scheduled) * 100) : 100;

  return (
    <>
      <h1>
        {t('dashboard')} · <span style={{ textTransform: 'capitalize' }}>{formatDate(data.date, i18n.language)}</span>
      </h1>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        <div className="card stat">
          <div className="value">
            {done}/{tasks.length}
          </div>
          <div className="label">{t('todayProgress')}</div>
        </div>
        <div className="card stat">
          <div className="value">{pct}%</div>
          <div className="label">{t('weekCompliance')}</div>
        </div>
        <Link to="/admin/incidents" className="card stat" style={{ textDecoration: 'none' }}>
          <div className="value" style={{ color: data.openIncidents ? 'var(--red)' : undefined }}>
            {data.openIncidents}
          </div>
          <div className="label">{t('openIncidents')}</div>
        </Link>
        <div className="card stat">
          <div className="value">{data.workers}</div>
          <div className="label">{t('activeWorkers')}</div>
        </div>
      </div>

      <h2 className="mt">{t('today')}</h2>
      <div className="grid">
        {data.today.map((m) => (
          <Link key={m.id} to={`/machine/${m.id}`} className={`card machine-card ${m.tasks.length && m.tasks.every((x) => x.done) ? 'accent' : m.tasks.length ? 'warn' : ''}`}>
            <span className="num-chip">{m.number}</span>
            <div style={{ flex: 1 }}>
              <strong>{m.name}</strong>
              {m.tasks.length === 0 && <div className="muted small">{t('notScheduledToday')}</div>}
              {m.tasks.map((tk) => (
                <div key={tk.planId} className="small">
                  {tk.done ? (
                    <span className="badge">✓ {t('doneBy', { name: tk.done.by, time: tk.done.time })}</span>
                  ) : (
                    <span className="badge yellow">⏳ {t('pending')}</span>
                  )}{' '}
                  {tk.strict && <span className="badge blue">⭐</span>}
                </div>
              ))}
            </div>
          </Link>
        ))}
      </div>

      {data.week.missed.length > 0 && (
        <>
          <h2 className="mt">{t('missedCleanings')}</h2>
          <div className="card danger table-wrap">
            <table>
              <tbody>
                {data.week.missed.map((m, i) => (
                  <tr key={i}>
                    <td>{formatDate(m.date, i18n.language)}</td>
                    <td>{m.label}</td>
                    <td>{m.strict && <span className="badge blue">⭐ {t('strictDay')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 className="mt">{t('recentCleanings')}</h2>
      <div className="card table-wrap">
        {data.recent.length === 0 ? (
          <p className="muted">{t('noRecords')}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{t('date')}</th>
                <th>{t('machine')}</th>
                <th>{t('worker')}</th>
                <th>{t('status')}</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/record/${r.id}`}>
                      {formatDate(r.date, i18n.language)} {r.time}
                    </Link>
                  </td>
                  <td>{r.machine}</td>
                  <td>{r.user}</td>
                  <td>
                    <StatusBadge status={r.status} /> {r.wasStrict && '⭐'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ---------- Máquinas ----------
type MachineForm = Pick<Machine, 'number' | 'name' | 'model' | 'serialNumber' | 'manufacturer' | 'location' | 'status'>;

function MachineFormFields({ value, onChange }: { value: MachineForm; onChange: (v: MachineForm) => void }) {
  const { t } = useTranslation();
  const set = (k: keyof MachineForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange({ ...value, [k]: k === 'number' ? Number(e.target.value) : e.target.value });
  return (
    <>
      <div className="grid2">
        <label className="field">
          <span>{t('number')}</span>
          <input type="number" min={1} required value={value.number || ''} onChange={set('number')} />
        </label>
        <label className="field">
          <span>{t('status')}</span>
          <select value={value.status} onChange={set('status')}>
            <option value="OK">{t('OK')}</option>
            <option value="MAINTENANCE">{t('MAINTENANCE_STATUS')}</option>
            <option value="OUT_OF_SERVICE">{t('OUT_OF_SERVICE')}</option>
          </select>
        </label>
      </div>
      <label className="field">
        <span>{t('name')}</span>
        <input required value={value.name} onChange={set('name')} />
      </label>
      <div className="grid2">
        <label className="field">
          <span>{t('model')}</span>
          <input value={value.model ?? ''} onChange={set('model')} />
        </label>
        <label className="field">
          <span>{t('serialNumber')}</span>
          <input value={value.serialNumber ?? ''} onChange={set('serialNumber')} />
        </label>
        <label className="field">
          <span>{t('manufacturer')}</span>
          <input value={value.manufacturer ?? ''} onChange={set('manufacturer')} />
        </label>
        <label className="field">
          <span>{t('location')}</span>
          <input value={value.location ?? ''} onChange={set('location')} />
        </label>
      </div>
    </>
  );
}

export function MachinesAdminPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const errText = useErrorText();
  const { data } = useLoad<{ machines: Machine[] }>('/machines');
  const [creating, setCreating] = useState<MachineForm | null>(null);
  const [error, setError] = useState('');

  if (!data) return <Loading />;
  const nextNumber = Math.max(0, ...data.machines.map((m) => m.number)) + 1;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const m = await api.post<Machine>('/machines', creating);
      navigate(`/admin/machines/${m.id}`);
    } catch (err) {
      setError(errText(err));
    }
  };

  return (
    <>
      <div className="row between">
        <h1 style={{ margin: 0 }}>{t('machines')}</h1>
        <button
          className="btn"
          onClick={() => {
            setError('');
            setCreating({ number: nextNumber, name: '', model: '', serialNumber: '', manufacturer: '', location: '', status: 'OK' });
          }}
        >
          + {t('newMachine')}
        </button>
      </div>
      <div className="grid mt">
        {data.machines.map((m) => (
          <Link key={m.id} to={`/admin/machines/${m.id}`} className="card machine-card">
            {m.photoUrl ? <img src={m.photoUrl} alt="" className="thumb" /> : <span className="thumb" />}
            <div style={{ flex: 1 }}>
              <div className="row" style={{ gap: 6 }}>
                <span className="num-chip">{m.number}</span>
                <strong>{m.name}</strong>
              </div>
              <div className="muted small mt" style={{ marginTop: 4 }}>
                {[m.model, m.serialNumber && `S/N ${m.serialNumber}`].filter(Boolean).join(' · ')}
              </div>
              <StatusBadge status={m.status} />
            </div>
          </Link>
        ))}
      </div>
      {creating && (
        <Modal title={t('newMachine')} onClose={() => setCreating(null)}>
          <form onSubmit={create}>
            {error && <div className="alert error">{error}</div>}
            <MachineFormFields value={creating} onChange={setCreating} />
            <button className="btn block">{t('save')}</button>
          </form>
        </Modal>
      )}
    </>
  );
}

export function MachineAdminPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const errText = useErrorText();
  const { data, reload } = useLoad<{ machine: Machine }>(`/machines/${id}`);
  const plans = useLoad<Plan[]>(`/machines/${id}/plans`);
  const [form, setForm] = useState<MachineForm | null>(null);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [error, setError] = useState('');
  const [qrVersion, setQrVersion] = useState(0);

  useEffect(() => {
    if (data) setForm(data.machine);
  }, [data]);

  if (!data || !form) return <Loading />;
  const m = data.machine;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const { number, name, model, serialNumber, manufacturer, location, status } = form;
      await api.patch(`/machines/${m.id}`, { number, name, model, serialNumber, manufacturer, location, status });
      toast(t('saved'));
      reload();
    } catch (err) {
      setError(errText(err));
    }
  };

  const uploadPhoto = async (f?: File) => {
    if (!f) return;
    const fd = new FormData();
    fd.append('photo', await compressImage(f), 'machine.jpg');
    await api.post(`/machines/${m.id}/photo`, fd);
    reload();
  };

  return (
    <>
      <Link to="/admin/machines" className="btn ghost small">
        ← {t('machines')}
      </Link>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <form className="card accent" onSubmit={save}>
          <h2>{t('editMachine')}</h2>
          {m.photoUrl && <img src={m.photoUrl} alt="" className="machine-hero" />}
          <label className="btn secondary small mt" style={{ marginBottom: 12 }}>
            📷 {t('uploadPhoto')}
            <input type="file" accept="image/*" hidden onChange={(e) => uploadPhoto(e.target.files?.[0])} />
          </label>
          {error && <div className="alert error">{error}</div>}
          <MachineFormFields value={form} onChange={setForm} />
          <div className="row">
            <button className="btn">{t('save')}</button>
            <button
              type="button"
              className="btn ghost"
              style={{ color: 'var(--red)' }}
              onClick={async () => {
                if (!confirm(t('confirmDelete'))) return;
                await api.del(`/machines/${m.id}`);
                navigate('/admin/machines');
              }}
            >
              {t('delete')}
            </button>
          </div>
        </form>

        <div className="card center">
          <h2>{t('qrCode')}</h2>
          <img src={`/api/machines/${m.id}/qr.png?v=${qrVersion}-${m.qrToken}`} alt="QR" style={{ width: 220, maxWidth: '100%' }} />
          <p className="small muted" style={{ wordBreak: 'break-all' }}>
            {m.qrUrl}
          </p>
          <div className="stack">
            <a className="btn block" href={`/api/machines/${m.id}/label.pdf`}>
              🖨 {t('downloadLabel')}
            </a>
            <a className="btn secondary block" href={`/api/machines/${m.id}/qr.png`} download={`QR-${m.number}.png`}>
              ⬇ {t('downloadQr')}
            </a>
            <button
              className="btn ghost block"
              onClick={async () => {
                if (!confirm(t('regenerateQrConfirm'))) return;
                await api.post(`/machines/${m.id}/regenerate-qr`);
                setQrVersion((v) => v + 1);
                reload();
              }}
            >
              ↻ {t('regenerateQr')}
            </button>
          </div>
        </div>
      </div>

      <div className="row between mt">
        <h2 style={{ margin: 0 }}>{t('cleaningPlans')}</h2>
        <button
          className="btn"
          onClick={() =>
            setEditingPlan({ id: 0, name: '', weekdays: [1, 2, 3, 4, 5], strictDays: [5], active: true, steps: [{ textDe: '', textEn: '', textEs: '', onlyStrictDays: false }] })
          }
        >
          + {t('newPlan')}
        </button>
      </div>
      {plans.data?.map((p) => <PlanSummary key={p.id} plan={p} onEdit={() => setEditingPlan(p)} />)}
      {editingPlan && (
        <PlanEditor
          machineId={m.id}
          plan={editingPlan}
          onClose={() => setEditingPlan(null)}
          onSaved={() => {
            setEditingPlan(null);
            plans.reload();
            toast(t('saved'));
          }}
        />
      )}
    </>
  );
}

function PlanSummary({ plan, onEdit }: { plan: Plan; onEdit: () => void }) {
  const { t, i18n } = useTranslation();
  const names = weekdayNames(i18n.language);
  const key = i18n.language === 'en' ? 'textEn' : i18n.language === 'es' ? 'textEs' : 'textDe';
  return (
    <div className={`card ${plan.active ? 'accent' : ''}`}>
      <div className="row between">
        <strong>{plan.name}</strong>
        <div className="row" style={{ gap: 6 }}>
          {!plan.active && <span className="badge grey">{t('inactive')}</span>}
          <button className="btn secondary small" onClick={onEdit}>
            {t('edit')}
          </button>
        </div>
      </div>
      <div className="day-picker mt">
        {names.map((n, i) => (
          <span
            key={i}
            className={`badge ${plan.strictDays.includes(i + 1) ? 'blue' : plan.weekdays.includes(i + 1) ? '' : 'grey'}`}
            style={{ textTransform: 'capitalize' }}
          >
            {plan.strictDays.includes(i + 1) ? '⭐ ' : ''}
            {n}
          </span>
        ))}
      </div>
      <ol className="small" style={{ paddingLeft: 20, marginBottom: 0 }}>
        {plan.steps.map((s, i) => (
          <li key={i}>
            {s[key]} {s.onlyStrictDays && <span className="badge blue">⭐</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function PlanEditor({ machineId, plan, onClose, onSaved }: { machineId: number; plan: Plan; onClose: () => void; onSaved: () => void }) {
  const { t, i18n } = useTranslation();
  const errText = useErrorText();
  const [p, setP] = useState<Plan>(structuredClone(plan));
  const [error, setError] = useState('');
  const names = weekdayNames(i18n.language);

  const toggle = (field: 'weekdays' | 'strictDays', d: number) =>
    setP({ ...p, [field]: p[field].includes(d) ? p[field].filter((x) => x !== d) : [...p[field], d] });

  const setStep = (i: number, patch: Partial<Plan['steps'][number]>) =>
    setP({ ...p, steps: p.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const move = (i: number, dir: -1 | 1) => {
    const steps = [...p.steps];
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setP({ ...p, steps });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const body = { name: p.name, weekdays: p.weekdays, strictDays: p.strictDays, active: p.active, steps: p.steps };
    try {
      if (p.id) await api.put(`/plans/${p.id}`, body);
      else await api.post(`/machines/${machineId}/plans`, body);
      onSaved();
    } catch (err) {
      setError(errText(err));
    }
  };

  return (
    <Modal title={p.id ? t('edit') : t('newPlan')} onClose={onClose}>
      <form onSubmit={save}>
        {error && <div className="alert error">{error}</div>}
        <label className="field">
          <span>{t('planName')}</span>
          <input required value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
        </label>
        <div className="field">
          <span style={{ fontWeight: 700 }}>{t('weekdays')}</span>
          <div className="day-picker mt" style={{ marginTop: 4 }}>
            {names.map((n, i) => (
              <button type="button" key={i} className={p.weekdays.includes(i + 1) ? 'on' : ''} onClick={() => toggle('weekdays', i + 1)}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="field mt">
          <span style={{ fontWeight: 700 }}>⭐ {t('strictDays')}</span>
          <div className="day-picker yellow" style={{ marginTop: 4 }}>
            {names.map((n, i) => (
              <button type="button" key={i} className={p.strictDays.includes(i + 1) ? 'on' : ''} onClick={() => toggle('strictDays', i + 1)}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <label className="row mt" style={{ fontWeight: 700 }}>
          <input type="checkbox" checked={p.active} onChange={(e) => setP({ ...p, active: e.target.checked })} /> {t('active')}
        </label>

        <h3 className="mt">{t('steps')}</h3>
        {p.steps.map((s, i) => (
          <div key={i} className={`card ${s.onlyStrictDays ? 'warn' : ''}`} style={{ padding: 12 }}>
            <div className="row between">
              <strong>#{i + 1}</strong>
              <div className="row" style={{ gap: 2 }}>
                <button type="button" className="btn ghost small" onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="btn ghost small" onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button
                  type="button"
                  className="btn ghost small"
                  style={{ color: 'var(--red)' }}
                  onClick={() => setP({ ...p, steps: p.steps.filter((_, j) => j !== i) })}
                  disabled={p.steps.length === 1}
                >
                  ✕
                </button>
              </div>
            </div>
            {LANGUAGES.map((l) => {
              const k = l.code === 'de' ? 'textDe' : l.code === 'en' ? 'textEn' : 'textEs';
              return (
                <label key={l.code} className="field" style={{ marginBottom: 6 }}>
                  <input required placeholder={`${l.flag} ${l.label}`} value={s[k]} onChange={(e) => setStep(i, { [k]: e.target.value })} />
                </label>
              );
            })}
            <label className="row small" style={{ fontWeight: 700 }}>
              <input type="checkbox" checked={s.onlyStrictDays} onChange={(e) => setStep(i, { onlyStrictDays: e.target.checked })} /> ⭐{' '}
              {t('onlyStrict')}
            </label>
          </div>
        ))}
        <button type="button" className="btn secondary block" onClick={() => setP({ ...p, steps: [...p.steps, { textDe: '', textEn: '', textEs: '', onlyStrictDays: false }] })}>
          + {t('addStep')}
        </button>
        <div className="row mt">
          {p.id > 0 && (
            <button
              type="button"
              className="btn ghost"
              style={{ color: 'var(--red)' }}
              onClick={async () => {
                if (!confirm(t('confirmDelete'))) return;
                await api.del(`/plans/${p.id}`);
                onSaved();
              }}
            >
              {t('delete')}
            </button>
          )}
          <button className="btn" style={{ flex: 1 }}>
            {t('save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Incidencias ----------
export function IncidentsPage() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('open');
  const { data, reload } = useLoad<Incident[]>(`/incidents?status=${status}`);
  const [resolving, setResolving] = useState<Incident | null>(null);
  const [resolution, setResolution] = useState('');

  return (
    <>
      <h1>{t('incidents')}</h1>
      <div className="row" style={{ marginBottom: 12 }}>
        {(['open', 'resolved', 'all'] as const).map((s) => (
          <button key={s} className={`btn small ${status === s ? '' : 'secondary'}`} onClick={() => setStatus(s)}>
            {t(s)}
          </button>
        ))}
      </div>
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <p className="muted">{t('noRecords')}</p>
      ) : (
        data.map((inc) => (
          <div key={inc.id} className={`card ${inc.resolved ? 'accent' : 'danger'}`}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <a href={inc.photoUrl} target="_blank" rel="noreferrer">
                <img src={inc.photoUrl} alt="" style={{ width: 110, height: 110, objectFit: 'cover', borderRadius: 10 }} />
              </a>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span className="num-chip">{inc.machine?.number}</span>
                  <strong>{inc.machine?.name}</strong>
                </div>
                <div className="row mt" style={{ gap: 6, marginTop: 6 }}>
                  <span className={`badge ${inc.severity === 'HIGH' ? 'red' : inc.severity === 'MEDIUM' ? 'yellow' : 'grey'}`}>{t(inc.severity)}</span>
                  <span className={`badge ${inc.resolved ? '' : 'red'}`}>{inc.resolved ? t('resolved') : t('open')}</span>
                </div>
                <p style={{ margin: '8px 0' }}>{inc.description}</p>
                <div className="muted small">
                  {t('reportedBy')}: {inc.user?.fullName} · {formatDateTime(inc.createdAt, i18n.language)}
                </div>
                {inc.resolved && inc.resolution && (
                  <div className="alert ok small mt" style={{ marginBottom: 0 }}>
                    {t('resolution')}: {inc.resolution}
                  </div>
                )}
              </div>
            </div>
            <div className="row mt" style={{ justifyContent: 'flex-end' }}>
              {inc.resolved ? (
                <button
                  className="btn secondary small"
                  onClick={async () => {
                    await api.patch(`/incidents/${inc.id}`, { resolved: false });
                    reload();
                  }}
                >
                  {t('reopen')}
                </button>
              ) : (
                <button
                  className="btn small"
                  onClick={() => {
                    setResolution('');
                    setResolving(inc);
                  }}
                >
                  ✓ {t('markResolved')}
                </button>
              )}
            </div>
          </div>
        ))
      )}
      {resolving && (
        <Modal title={t('markResolved')} onClose={() => setResolving(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await api.patch(`/incidents/${resolving.id}`, { resolved: true, resolution });
              setResolving(null);
              reload();
            }}
          >
            <label className="field">
              <span>{t('resolution')}</span>
              <textarea value={resolution} onChange={(e) => setResolution(e.target.value)} />
            </label>
            <button className="btn block">{t('save')}</button>
          </form>
        </Modal>
      )}
    </>
  );
}

// ---------- Mantenimiento ----------
export function MaintenancePage() {
  const { t, i18n } = useTranslation();
  const errText = useErrorText();
  const machines = useLoad<{ machines: Machine[] }>('/machines');
  const { data, reload } = useLoad<MaintenanceLog[]>('/maintenance');
  const [form, setForm] = useState<Partial<MaintenanceLog> | null>(null);
  const [error, setError] = useState('');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const body = {
      machineId: Number(form!.machineId),
      type: form!.type,
      description: form!.description,
      technician: form!.technician || null,
      date: form!.date,
      cost: form!.cost === undefined || form!.cost === null || (form!.cost as unknown) === '' ? null : Number(form!.cost),
    };
    try {
      if (form!.id) await api.put(`/maintenance/${form!.id}`, body);
      else await api.post('/maintenance', body);
      setForm(null);
      reload();
    } catch (err) {
      setError(errText(err));
    }
  };

  return (
    <>
      <div className="row between">
        <h1 style={{ margin: 0 }}>{t('maintenance')}</h1>
        <button
          className="btn"
          onClick={() => {
            setError('');
            setForm({ machineId: machines.data?.machines[0]?.id, type: 'MAINTENANCE', date: todayIso(), description: '' });
          }}
        >
          + {t('newEntry')}
        </button>
      </div>
      <div className="mt">
        {!data ? (
          <Loading />
        ) : data.length === 0 ? (
          <p className="muted">{t('noRecords')}</p>
        ) : (
          data.map((l) => (
            <div key={l.id} className="card accent">
              <div className="row between">
                <div className="row" style={{ gap: 6 }}>
                  <span className="num-chip">{l.machine?.number}</span>
                  <strong>{l.machine?.name}</strong>
                </div>
                <span className={`badge ${l.type === 'REPAIR' ? 'red' : l.type === 'UPDATE' ? 'blue' : 'yellow'}`}>{t(l.type)}</span>
              </div>
              <p style={{ margin: '8px 0' }}>{l.description}</p>
              <div className="row between">
                <span className="muted small">
                  {formatDate(l.date, i18n.language)}
                  {l.technician && ` · ${t('technician')}: ${l.technician}`}
                  {l.cost != null && ` · ${l.cost.toFixed(2)} €`}
                </span>
                <div className="row" style={{ gap: 4 }}>
                  <button className="btn ghost small" onClick={() => setForm(l)}>
                    {t('edit')}
                  </button>
                  <button
                    className="btn ghost small"
                    style={{ color: 'var(--red)' }}
                    onClick={async () => {
                      if (!confirm(t('confirmDelete'))) return;
                      await api.del(`/maintenance/${l.id}`);
                      reload();
                    }}
                  >
                    {t('delete')}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      {form && (
        <Modal title={form.id ? t('edit') : t('newEntry')} onClose={() => setForm(null)}>
          <form onSubmit={save}>
            {error && <div className="alert error">{error}</div>}
            <label className="field">
              <span>{t('machine')}</span>
              <select required value={form.machineId ?? ''} onChange={(e) => setForm({ ...form, machineId: Number(e.target.value) })}>
                {machines.data?.machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    Nº{m.number} {m.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid2">
              <label className="field">
                <span>{t('type')}</span>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as MaintenanceLog['type'] })}>
                  <option value="MAINTENANCE">{t('MAINTENANCE')}</option>
                  <option value="REPAIR">{t('REPAIR')}</option>
                  <option value="UPDATE">{t('UPDATE')}</option>
                </select>
              </label>
              <label className="field">
                <span>{t('date')}</span>
                <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </label>
            </div>
            <label className="field">
              <span>{t('description')}</span>
              <textarea required minLength={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <div className="grid2">
              <label className="field">
                <span>{t('technician')}</span>
                <input value={form.technician ?? ''} onChange={(e) => setForm({ ...form, technician: e.target.value })} />
              </label>
              <label className="field">
                <span>{t('cost')}</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.cost ?? ''}
                  onChange={(e) => setForm({ ...form, cost: e.target.value === '' ? null : Number(e.target.value) })}
                />
              </label>
            </div>
            <button className="btn block">{t('save')}</button>
          </form>
        </Modal>
      )}
    </>
  );
}

// ---------- Usuarios ----------
export function UsersPage() {
  const { t, i18n } = useTranslation();
  const { user: me } = useAuth();
  const toast = useToast();
  const errText = useErrorText();
  const { data, reload } = useLoad<User[]>('/users');
  const [resetFor, setResetFor] = useState<User | null>(null);
  const [newPw, setNewPw] = useState('');

  const patch = async (u: User, body: object) => {
    try {
      await api.patch(`/users/${u.id}`, body);
      reload();
    } catch (err) {
      toast(errText(err));
    }
  };

  if (!data) return <Loading />;
  return (
    <>
      <h1>{t('users')}</h1>
      {data.map((u) => (
        <div key={u.id} className={`card ${u.active ? 'accent' : ''}`} style={u.active ? undefined : { opacity: 0.65 }}>
          <div className="row between">
            <div>
              <strong>{u.fullName}</strong> <span className="muted small">@{u.username}</span>
              <div className="muted small">
                {u.email} · {formatDate(u.createdAt, i18n.language)} · {u.records} {t('records')}
              </div>
            </div>
            <div className="row" style={{ gap: 4 }}>
              <span className={`badge ${u.role === 'ADMIN' ? 'yellow' : ''}`}>{t(u.role)}</span>
              {!u.active && <span className="badge grey">{t('inactive')}</span>}
            </div>
          </div>
          {u.id !== me!.id && (
            <div className="row mt" style={{ gap: 6 }}>
              <button className="btn secondary small" onClick={() => patch(u, { active: !u.active })}>
                {u.active ? t('disable') : t('enable')}
              </button>
              <select style={{ width: 'auto' }} value={u.role} onChange={(e) => patch(u, { role: e.target.value })}>
                <option value="WORKER">{t('WORKER')}</option>
                <option value="ADMIN">{t('ADMIN')}</option>
              </select>
              <button
                className="btn ghost small"
                onClick={() => {
                  setNewPw('');
                  setResetFor(u);
                }}
              >
                🔑 {t('resetPassword')}
              </button>
            </div>
          )}
        </div>
      ))}
      {resetFor && (
        <Modal title={`${t('resetPassword')} · ${resetFor.fullName}`} onClose={() => setResetFor(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await patch(resetFor, { newPassword: newPw });
              setResetFor(null);
              toast(t('saved'));
            }}
          >
            <label className="field">
              <span>
                {t('newPassword')} <small>· {t('passwordHint')}</small>
              </span>
              <input type="text" required minLength={8} value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            </label>
            <button className="btn block">{t('save')}</button>
          </form>
        </Modal>
      )}
    </>
  );
}

// ---------- Informes ----------
export function ReportsPage() {
  const { t, i18n } = useTranslation();
  const machines = useLoad<{ machines: Machine[] }>('/machines');
  const monthStart = todayIso().slice(0, 8) + '01';
  const [f, setF] = useState({ from: monthStart, to: todayIso(), machineId: '', lang: i18n.language });

  const qs = new URLSearchParams({ from: f.from, to: f.to, lang: f.lang, ...(f.machineId ? { machineId: f.machineId } : {}) }).toString();
  const reports = [
    { type: 'cleaning', icon: '🧽', title: t('cleaningReport'), desc: t('cleaningReportDesc'), csv: true },
    { type: 'compliance', icon: '📈', title: t('complianceReport'), desc: t('complianceReportDesc') },
    { type: 'incidents', icon: '⚠', title: t('incidentReport'), desc: t('incidentReportDesc') },
    { type: 'maintenance', icon: '🔧', title: t('maintenanceReport'), desc: t('maintenanceReportDesc') },
  ];

  return (
    <>
      <h1>{t('reports')}</h1>
      <div className="card warn">
        <div className="grid2">
          <label className="field">
            <span>{t('from')}</span>
            <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          </label>
          <label className="field">
            <span>{t('to')}</span>
            <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
          </label>
          <label className="field">
            <span>{t('machine')}</span>
            <select value={f.machineId} onChange={(e) => setF({ ...f, machineId: e.target.value })}>
              <option value="">{t('all')}</option>
              {machines.data?.machines.map((m) => (
                <option key={m.id} value={m.id}>
                  Nº{m.number} {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('reportLanguage')}</span>
            <select value={f.lang} onChange={(e) => setF({ ...f, lang: e.target.value })}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.flag} {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="grid">
        {reports.map((r) => (
          <div key={r.type} className="card accent">
            <h3>
              {r.icon} {r.title}
            </h3>
            <p className="muted small">{r.desc}</p>
            <div className="row">
              <a className="btn" href={`/api/reports/${r.type}.pdf?${qs}`}>
                📄 {t('downloadPdf')}
              </a>
              {r.csv && (
                <a className="btn secondary" href={`/api/reports/${r.type}.csv?${qs}`}>
                  {t('exportCsv')}
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
