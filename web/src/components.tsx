import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError, compressImage, type Incident, type User } from './api';
import i18n, { LANGUAGES } from './i18n';

// ---------- Sesión ----------
interface AuthCtx {
  user: User | null;
  loading: boolean;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const setUser = useCallback((u: User | null) => {
    setUserState(u);
    if (u && u.language !== i18n.language) i18n.changeLanguage(u.language);
  }, []);

  useEffect(() => {
    api
      .get<User>('/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [setUser]);

  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    setUserState(null);
  };

  return <AuthContext.Provider value={{ user, loading, setUser, logout }}>{children}</AuthContext.Provider>;
}

// ---------- Mensajes ----------
export function useErrorText() {
  const { t } = useTranslation();
  return (e: unknown) => {
    const code = e instanceof ApiError ? e.code : 'SERVER_ERROR';
    const key = `errors.${code}`;
    return i18n.exists(key) ? t(key) : t('error');
  };
}

const ToastContext = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 3000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {msg && (
        <div className="toast" role="status">
          {msg}
        </div>
      )}
    </ToastContext.Provider>
  );
}

// ---------- Idioma ----------
export function LangSwitcher() {
  const { i18n: i } = useTranslation();
  const { user, setUser } = useAuth();
  const change = async (code: 'de' | 'en' | 'es') => {
    i.changeLanguage(code);
    if (user) {
      const u = await api.patch<User>('/auth/me', { language: code }).catch(() => null);
      if (u) setUser(u);
    }
  };
  return (
    <div className="langs" aria-label="Language">
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          className={i.language === l.code ? 'active' : ''}
          onClick={() => change(l.code)}
          title={l.label}
        >
          {l.code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

// ---------- Modal ----------
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn ghost" onClick={onClose} aria-label={t('close')}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------- Firma ----------
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);

  const setup = useCallback(() => {
    const c = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1d2414';
    hasInk.current = false;
    onChange(null);
  }, [onChange]);

  useEffect(() => {
    setup();
  }, [setup]);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const exportPng = () => {
    // Exporta a tamaño reducido para no guardar imágenes enormes
    const src = ref.current!;
    const out = document.createElement('canvas');
    out.width = 500;
    out.height = Math.round((500 * src.height) / src.width);
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0, out.width, out.height);
    onChange(out.toDataURL('image/png'));
  };

  return (
    <div>
      <canvas
        ref={ref}
        className="sigpad"
        onPointerDown={(e) => {
          drawing.current = true;
          ref.current!.setPointerCapture(e.pointerId);
          const ctx = ref.current!.getContext('2d')!;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + 0.1, p.y + 0.1);
          ctx.stroke();
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = ref.current!.getContext('2d')!;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          hasInk.current = true;
        }}
        onPointerUp={() => {
          drawing.current = false;
          if (hasInk.current) exportPng();
        }}
      />
      <div className="row between mt">
        <span className="muted small">{t('signHere')}</span>
        <button type="button" className="btn ghost small" onClick={setup}>
          {t('clear')}
        </button>
      </div>
    </div>
  );
}

// ---------- Formulario de incidencia (foto obligatoria) ----------
export function IncidentForm({ machineId, onSaved, onCancel }: { machineId: number; onSaved: (i: Incident) => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const errText = useErrorText();
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    const blob = await compressImage(f);
    setPhoto(blob);
    setPreview(URL.createObjectURL(blob));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!photo) return setError(t('photoRequired'));
    setBusy(true);
    setError('');
    const fd = new FormData();
    fd.append('machineId', String(machineId));
    fd.append('description', description);
    fd.append('severity', severity);
    fd.append('photo', photo, 'incident.jpg');
    try {
      onSaved(await api.post<Incident>('/incidents', fd));
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      {error && <div className="alert error">{error}</div>}
      <label className="field">
        <span>{t('incidentDescription')}</span>
        <textarea required minLength={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="field">
        <span>{t('severity')}</span>
        <select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
          <option value="LOW">{t('LOW')}</option>
          <option value="MEDIUM">{t('MEDIUM')}</option>
          <option value="HIGH">{t('HIGH')}</option>
        </select>
      </label>
      {preview && <img src={preview} alt="" className="photo-preview" />}
      <label className="btn yellow block mt">
        📷 {preview ? t('changePhoto') : t('takePhoto')}
        <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      <div className="row mt">
        <button type="button" className="btn secondary" onClick={onCancel}>
          {t('cancel')}
        </button>
        <button className="btn" style={{ flex: 1 }} disabled={busy}>
          {t('save')}
        </button>
      </div>
    </form>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  if (status === 'OK') return <span className="badge">{t('OK')}</span>;
  if (status === 'WITH_ISSUES') return <span className="badge red">{t('WITH_ISSUES')}</span>;
  if (status === 'MAINTENANCE') return <span className="badge yellow">{t('MAINTENANCE_STATUS')}</span>;
  return <span className="badge red">{t('OUT_OF_SERVICE')}</span>;
}

export function Loading() {
  const { t } = useTranslation();
  return <p className="muted center">{t('loading')}</p>;
}

export function useLoad<T>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    api
      .get<T>(url)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, tick, ...deps]);
  return { data, error, reload: () => setTick((x) => x + 1) };
}
