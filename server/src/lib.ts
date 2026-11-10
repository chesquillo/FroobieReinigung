import dotenv from 'dotenv';
import { fileURLToPath as _f } from 'node:url';
import _path from 'node:path';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

// .env.local (tus claves de Supabase) tiene prioridad sobre .env
{
  const root = _path.resolve(_path.dirname(_f(import.meta.url)), '..');
  try {
    const local = dotenv.parse(readFileSync(_path.join(root, '.env.local')));
    for (const [k, v] of Object.entries(local)) if (v.trim() && process.env[k] === undefined) process.env[k] = v.trim();
  } catch {
    /* sin .env.local */
  }
  dotenv.config({ path: _path.join(root, '.env'), quiet: true });
}
import { PrismaClient } from '@prisma/client';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const prisma = new PrismaClient();

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');
export const UPLOAD_DIR = path.join(SERVER_ROOT, 'uploads');
export const WEB_DIST = path.resolve(SERVER_ROOT, '..', 'web', 'dist');

// Secreto de las sesiones: JWT_SECRET si es válido; si no, se deriva de la clave secreta de Supabase
function resolveJwtSecret(): string {
  const given = process.env.JWT_SECRET ?? '';
  if (given.length >= 16 && !/escribe-aqui/.test(given)) return given;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';
  if (supaKey && !supaKey.startsWith('sb_publishable_')) {
    return createHmac('sha256', supaKey).update('froobie-session-secret-v1').digest('hex');
  }
  if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
    throw new Error('Falta JWT_SECRET (o SUPABASE_SERVICE_ROLE_KEY) en producción');
  }
  return 'dev-secret-change-me';
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: resolveJwtSecret(),
  timezone: process.env.APP_TIMEZONE ?? 'Europe/Berlin',
  publicUrl: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173').replace(/\/$/, ''),
  fakeToday: process.env.FAKE_TODAY || '',
  production: process.env.NODE_ENV === 'production',
};

export const LANGS = ['de', 'en', 'es'] as const;
export type Lang = (typeof LANGS)[number];

/** Fecha de trabajo (YYYY-MM-DD) en la zona horaria de la fábrica. */
export function todayStr(): string {
  if (config.fakeToday) return config.fakeToday;
  return dateInTz(new Date());
}

export function dateInTz(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function timeInTz(d: Date): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: config.timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** Día ISO de la semana (1 = lunes … 7 = domingo) para una fecha YYYY-MM-DD. */
export function isoWeekday(date: string): number {
  const d = new Date(date + 'T12:00:00Z');
  const wd = d.getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function parseDays(csv: string): number[] {
  return csv
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => n >= 1 && n <= 7);
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function stepText(step: { textDe: string; textEn: string; textEs: string }, lang: string): string {
  if (lang === 'en') return step.textEn;
  if (lang === 'es') return step.textEs;
  return step.textDe;
}

export async function audit(userId: number | null, action: string, details?: unknown) {
  await prisma.auditLog.create({
    data: { userId, action, details: details === undefined ? null : JSON.stringify(details) },
  });
}
