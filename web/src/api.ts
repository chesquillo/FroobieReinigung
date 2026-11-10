export class ApiError extends Error {
  constructor(public code: string, public status: number) {
    super(code);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch('/api' + url, {
    method,
    credentials: 'include',
    headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (!res.ok) {
    let code = 'SERVER_ERROR';
    try {
      const data = await res.json();
      code = data.error ?? code;
      if (code === 'VALIDATION' && data.issues?.[0]?.message && /^[A-Z_]+$/.test(data.issues[0].message)) {
        code = data.issues[0].message;
      }
    } catch {
      /* respuesta sin JSON */
    }
    throw new ApiError(code, res.status);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

/** Reduce una foto del móvil antes de subirla (máx. 1600 px, JPEG). */
export async function compressImage(file: File, max = 1600): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.82));
  } catch {
    return file;
  }
}

// ---------- Tipos ----------
export interface User {
  id: number;
  username: string;
  email: string;
  fullName: string;
  role: 'ADMIN' | 'WORKER';
  language: 'de' | 'en' | 'es';
  active: boolean;
  createdAt: string;
  records?: number;
}

export interface Task {
  planId: number;
  planName: string;
  strict: boolean;
  steps: { id: number; text: string; onlyStrictDays: boolean }[];
  done: null | { recordId: number; by: string; time: string; status: string };
}

export interface Machine {
  id: number;
  number: number;
  name: string;
  model: string | null;
  serialNumber: string | null;
  manufacturer: string | null;
  location: string | null;
  photoUrl: string | null;
  status: 'OK' | 'MAINTENANCE' | 'OUT_OF_SERVICE';
  qrToken?: string;
  qrUrl?: string;
  tasks?: Task[];
  openIncidents?: number;
}

export interface Incident {
  id: number;
  machineId: number;
  description: string;
  photoUrl: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  resolved: boolean;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  machine?: { number: number; name: string };
  user?: { fullName: string };
}

export interface MaintenanceLog {
  id: number;
  machineId: number;
  type: 'UPDATE' | 'REPAIR' | 'MAINTENANCE';
  description: string;
  technician: string | null;
  date: string;
  cost: number | null;
  machine?: { number: number; name: string };
  user?: { fullName: string };
}

export interface Plan {
  id: number;
  name: string;
  weekdays: number[];
  strictDays: number[];
  active: boolean;
  steps: { textDe: string; textEn: string; textEs: string; onlyStrictDays: boolean }[];
}
