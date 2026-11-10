/**
 * Almacenamiento de fotos.
 * - Sin configuración: disco local (carpeta server/uploads).
 * - Con SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY: Supabase Storage (bucket privado, gratis hasta 1 GB).
 * Las fotos solo se sirven a usuarios con sesión iniciada (ruta GET /uploads/:name).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { UPLOAD_DIR } from './lib.js';

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
// Clave secreta (service_role o la nueva sb_secret_…). La clave pública/anon NO sirve para el servidor.
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
const BUCKET = process.env.SUPABASE_BUCKET ?? 'froobie-photos';
const isPublicKey = SUPABASE_KEY.startsWith('sb_publishable_');
if (isPublicKey) {
  console.warn('⚠ SUPABASE_SERVICE_ROLE_KEY contiene la clave PÚBLICA (sb_publishable_…). Usa la secreta (sb_secret_…). Fotos en disco local.');
}
export const useSupabase = !!(SUPABASE_URL && SUPABASE_KEY && !isPublicKey);

// Las claves nuevas (sb_secret_…) no son JWT: van solo en la cabecera apikey
const authHeaders = (): Record<string, string> =>
  SUPABASE_KEY.startsWith('sb_') ? { apikey: SUPABASE_KEY } : { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY };

export async function initStorage() {
  if (!useSupabase) {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    return;
  }
  // Crea el bucket privado si aún no existe (si ya existe, Supabase responde con error y se ignora)
  await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  }).catch(() => undefined);
}

export function safeName(name: string) {
  return /^[A-Za-z0-9._-]{1,120}$/.test(name) && !name.startsWith('.') ? name : null;
}

export async function saveFile(name: string, data: Buffer, contentType: string): Promise<string> {
  if (useSupabase) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${name}`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': contentType, 'x-upsert': 'true' },
      body: new Uint8Array(data),
    });
    if (!res.ok) throw new Error(`Supabase upload failed: ${res.status} ${await res.text()}`);
  } else {
    await fs.writeFile(path.join(UPLOAD_DIR, name), data);
  }
  return `/uploads/${name}`;
}

/** Lee una foto por su URL (/uploads/<nombre>): primero disco local, después Supabase. */
export async function readFile(url: string | null | undefined): Promise<Buffer | null> {
  if (!url?.startsWith('/uploads/')) return null;
  const name = safeName(url.slice('/uploads/'.length));
  if (!name) return null;
  try {
    return await fs.readFile(path.join(UPLOAD_DIR, name));
  } catch {
    /* no está en disco */
  }
  if (!useSupabase) return null;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/${BUCKET}/${name}`, { headers: authHeaders() });
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
}

export function contentTypeOf(name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
}
