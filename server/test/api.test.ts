import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib.js';

let app: FastifyInstance;
let adminCookie = '';
let workerCookie = '';
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// PNG 1x1 válido para la foto de incidencia
const PNG = Buffer.from(SIG.split(',')[1], 'base64');

function cookieOf(res: { headers: Record<string, unknown> }) {
  const sc = res.headers['set-cookie'];
  const first = Array.isArray(sc) ? sc[0] : String(sc);
  return first.split(';')[0];
}

function multipart(fields: Record<string, string>, file?: { name: string; data: Buffer; type: string }) {
  const boundary = '----froobietest';
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('auth', () => {
  it('admin login', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'froobieadmin', password: 'test-admin-pass' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('ADMIN');
    adminCookie = cookieOf(res);
  });

  it('rejects wrong password', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'froobieadmin', password: 'nope' } });
    expect(res.statusCode).toBe(401);
  });

  it('requires a Gmail address to register', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'hans', fullName: 'Hans Müller', email: 'hans@web.de', password: 'geheim1234', language: 'de' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('registers a worker', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'hans', fullName: 'Hans Müller', email: 'Hans.Mueller@gmail.com', password: 'geheim1234', language: 'de' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ role: 'WORKER', email: 'hans.mueller@gmail.com' });
    workerCookie = cookieOf(res);
  });

  it('worker can change language', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: { cookie: workerCookie }, payload: { language: 'es' } });
    expect(res.json().language).toBe('es');
  });

  it('worker cannot access admin routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/users', headers: { cookie: workerCookie } });
    expect(res.statusCode).toBe(403);
  });
});

describe('cleaning flow (Friday = deep cleaning)', () => {
  let machineId = 0;
  let task: { planId: number; strict: boolean; steps: { id: number; text: string; onlyStrictDays: boolean }[] };
  let incidentId = 0;

  it('resolves QR token to machine', async () => {
    const m = await prisma.machine.findUniqueOrThrow({ where: { number: 1 } });
    const res = await app.inject({ method: 'GET', url: `/api/machines/by-qr/${m.qrToken}`, headers: { cookie: workerCookie } });
    expect(res.json().id).toBe(m.id);
    machineId = m.id;
  });

  it('shows Friday task with strict steps in worker language', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/machines/${machineId}`, headers: { cookie: workerCookie } });
    const body = res.json();
    expect(body.machine.qrToken).toBeUndefined();
    task = body.tasks[0];
    expect(task.strict).toBe(true);
    expect(task.steps.length).toBe(12);
    expect(task.steps[0].text).toBe('Apagar y desconectar la máquina');
  });

  it('incident requires a photo', async () => {
    const mp = multipart({ machineId: String(machineId), description: 'Junta rota', severity: 'HIGH' });
    const res = await app.inject({ method: 'POST', url: '/api/incidents', headers: { cookie: workerCookie, ...mp.headers }, payload: mp.payload });
    expect(res.statusCode).toBe(400);
  });

  it('reports incident with photo', async () => {
    const mp = multipart({ machineId: String(machineId), description: 'Junta rota', severity: 'HIGH' }, { name: 'a.png', data: PNG, type: 'image/png' });
    const res = await app.inject({ method: 'POST', url: '/api/incidents', headers: { cookie: workerCookie, ...mp.headers }, payload: mp.payload });
    expect(res.statusCode).toBe(200);
    incidentId = res.json().id;
  });

  it('rejects record without signature', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/records',
      headers: { cookie: workerCookie },
      payload: { machineId, planId: task.planId, steps: task.steps.map((s) => ({ stepId: s.id, checked: true })), signature: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unchecked steps without comment', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/records',
      headers: { cookie: workerCookie },
      payload: { machineId, planId: task.planId, steps: task.steps.map((s, i) => ({ stepId: s.id, checked: i > 0 })), signature: SIG },
    });
    expect(res.json().error).toBe('UNCHECKED_STEPS_NEED_COMMENT');
  });

  it('saves the cleaning record with incident', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/records',
      headers: { cookie: workerCookie },
      payload: {
        machineId,
        planId: task.planId,
        steps: task.steps.map((s) => ({ stepId: s.id, checked: true })),
        signature: SIG,
        comment: 'Todo limpio',
        incidentIds: [incidentId],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('WITH_ISSUES');
  });

  it('prevents a duplicate record for the same day', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/records',
      headers: { cookie: workerCookie },
      payload: { machineId, planId: task.planId, steps: [], signature: SIG, comment: 'x' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('admin dashboard shows the task done', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie: adminCookie } });
    const body = res.json();
    expect(body.today[0].tasks[0].done.by).toBe('Hans Müller');
    expect(body.openIncidents).toBe(1);
  });

  it('admin can log a repair', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/maintenance',
      headers: { cookie: adminCookie },
      payload: { machineId, type: 'REPAIR', description: 'Dichtung ersetzt', technician: 'Bertollo Service', date: '2026-11-12', cost: 120 },
    });
    expect(res.statusCode).toBe(200);
  });

  it.each(['cleaning.pdf', 'incidents.pdf', 'maintenance.pdf', 'compliance.pdf'])('generates %s', async (type) => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/reports/${type}?from=2026-11-01&to=2026-11-13&lang=de`,
      headers: { cookie: adminCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('exports CSV', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reports/cleaning.csv?from=2026-11-01&to=2026-11-13', headers: { cookie: adminCookie } });
    expect(res.body).toContain('Hans Müller');
  });

  it('admin QR label PDF', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/machines/${machineId}/label.pdf`, headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
  });
});

describe('photos & compliance', () => {
  it('photos require a session', async () => {
    const anon = await app.inject({ method: 'GET', url: '/uploads/machine-1.png' });
    expect(anon.statusCode).toBe(401);
    const ok = await app.inject({ method: 'GET', url: '/uploads/machine-1.png', headers: { cookie: workerCookie } });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/png');
  });

  it('rejects path traversal in photo names', async () => {
    const res = await app.inject({ method: 'GET', url: '/uploads/..%2F.env', headers: { cookie: workerCookie } });
    expect(res.statusCode).toBe(404);
  });

  it('does not count days before the plan existed as missed', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie: adminCookie } });
    // La orden se creó "hoy" (fecha real) y FAKE_TODAY es posterior; sólo puede haber días entre ambas fechas
    const created = new Date().toLocaleDateString('en-CA');
    for (const m of res.json().week.missed) expect(m.date >= created).toBe(true);
  });
});
