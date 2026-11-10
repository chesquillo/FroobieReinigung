import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../auth.js';
import { audit, config, prisma, todayStr } from '../lib.js';
import { machineTasks, newQrToken, saveUploadedImage } from '../services.js';
import { qrLabelPdf } from '../pdf/reports.js';

const machineSchema = z.object({
  number: z.coerce.number().int().min(1),
  name: z.string().trim().min(1).max(100),
  model: z.string().trim().max(100).optional().nullable(),
  serialNumber: z.string().trim().max(100).optional().nullable(),
  manufacturer: z.string().trim().max(100).optional().nullable(),
  location: z.string().trim().max(100).optional().nullable(),
  status: z.enum(['OK', 'MAINTENANCE', 'OUT_OF_SERVICE']).default('OK'),
});

const daysCsv = z
  .array(z.number().int().min(1).max(7))
  .transform((a) => [...new Set(a)].sort().join(','));

const planSchema = z.object({
  name: z.string().trim().min(1).max(100),
  weekdays: daysCsv,
  strictDays: daysCsv.default(''),
  active: z.boolean().default(true),
  steps: z
    .array(
      z.object({
        textDe: z.string().trim().min(1).max(300),
        textEn: z.string().trim().min(1).max(300),
        textEs: z.string().trim().min(1).max(300),
        onlyStrictDays: z.boolean().default(false),
      }),
    )
    .min(1),
});

const idParam = z.object({ id: z.coerce.number().int() });

export function qrUrl(token: string) {
  return `${config.publicUrl}/m/${token}`;
}

export default async function machineRoutes(app: FastifyInstance) {
  // Lista de máquinas con el estado de hoy (para trabajadores y admin)
  app.get('/machines', { preHandler: requireAuth }, async (req) => {
    const date = todayStr();
    const lang = req.currentUser!.language;
    const machines = await prisma.machine.findMany({ orderBy: { number: 'asc' } });
    const openIncidents = await prisma.incident.groupBy({
      by: ['machineId'],
      where: { resolved: false },
      _count: true,
    });
    return {
      date,
      machines: await Promise.all(
        machines.map(async (m) => ({
          ...m,
          qrToken: req.currentUser!.role === 'ADMIN' ? m.qrToken : undefined,
          tasks: await machineTasks(m.id, date, lang),
          openIncidents: openIncidents.find((o) => o.machineId === m.id)?._count ?? 0,
        })),
      ),
    };
  });

  // Resolver el QR escaneado → máquina
  app.get('/machines/by-qr/:token', { preHandler: requireAuth }, async (req, reply) => {
    const { token } = z.object({ token: z.string().max(64) }).parse(req.params);
    const m = await prisma.machine.findUnique({ where: { qrToken: token } });
    if (!m) return reply.code(404).send({ error: 'MACHINE_NOT_FOUND' });
    return { id: m.id };
  });

  app.get('/machines/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const m = await prisma.machine.findUnique({ where: { id } });
    if (!m) return reply.code(404).send({ error: 'MACHINE_NOT_FOUND' });
    const date = todayStr();
    const isAdmin = req.currentUser!.role === 'ADMIN';
    const [tasks, incidents, maintenance, recent] = await Promise.all([
      machineTasks(id, date, req.currentUser!.language),
      prisma.incident.findMany({
        where: { machineId: id, resolved: false },
        include: { user: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.maintenanceLog.findMany({ where: { machineId: id }, orderBy: { date: 'desc' }, take: 10 }),
      prisma.cleaningRecord.findMany({
        where: { machineId: id },
        include: { user: { select: { fullName: true } } },
        orderBy: { completedAt: 'desc' },
        take: 10,
      }),
    ]);
    return {
      machine: { ...m, qrToken: isAdmin ? m.qrToken : undefined, qrUrl: isAdmin ? qrUrl(m.qrToken) : undefined },
      date,
      tasks,
      openIncidents: incidents,
      maintenance,
      recentRecords: recent.map((r) => ({
        id: r.id,
        date: r.date,
        completedAt: r.completedAt,
        status: r.status,
        wasStrict: r.wasStrict,
        user: r.user.fullName,
      })),
    };
  });

  // ---------- Administración ----------
  app.post('/machines', { preHandler: requireAdmin }, async (req, reply) => {
    const data = machineSchema.parse(req.body);
    if (await prisma.machine.findUnique({ where: { number: data.number } })) {
      return reply.code(409).send({ error: 'NUMBER_TAKEN' });
    }
    const m = await prisma.machine.create({ data: { ...data, qrToken: newQrToken() } });
    await audit(req.currentUser!.id, 'MACHINE_CREATE', { id: m.id, name: m.name });
    return m;
  });

  app.patch('/machines/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const data = machineSchema.partial().parse(req.body);
    if (data.number !== undefined) {
      const other = await prisma.machine.findUnique({ where: { number: data.number } });
      if (other && other.id !== id) return reply.code(409).send({ error: 'NUMBER_TAKEN' });
    }
    const m = await prisma.machine.update({ where: { id }, data });
    await audit(req.currentUser!.id, 'MACHINE_UPDATE', { id, ...data });
    return m;
  });

  app.delete('/machines/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = idParam.parse(req.params);
    await prisma.machine.delete({ where: { id } });
    await audit(req.currentUser!.id, 'MACHINE_DELETE', { id });
    return { ok: true };
  });

  app.post('/machines/:id/photo', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { url } = await saveUploadedImage(req, `machine-${id}`);
    if (!url) return reply.code(400).send({ error: 'PHOTO_REQUIRED' });
    return prisma.machine.update({ where: { id }, data: { photoUrl: url } });
  });

  app.post('/machines/:id/regenerate-qr', { preHandler: requireAdmin }, async (req) => {
    const { id } = idParam.parse(req.params);
    const m = await prisma.machine.update({ where: { id }, data: { qrToken: newQrToken() } });
    await audit(req.currentUser!.id, 'MACHINE_QR_REGENERATE', { id });
    return m;
  });

  app.get('/machines/:id/qr.png', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const m = await prisma.machine.findUniqueOrThrow({ where: { id } });
    const png = await QRCode.toBuffer(qrUrl(m.qrToken), { width: 600, margin: 2, errorCorrectionLevel: 'M' });
    return reply.type('image/png').send(png);
  });

  app.get('/machines/:id/label.pdf', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const m = await prisma.machine.findUniqueOrThrow({ where: { id } });
    const pdf = await qrLabelPdf(m, qrUrl(m.qrToken));
    return reply
      .type('application/pdf')
      .header('Content-Disposition', `attachment; filename="QR-Maschine-${m.number}.pdf"`)
      .send(pdf);
  });

  // ---------- Órdenes de limpieza ----------
  app.get('/machines/:id/plans', { preHandler: requireAdmin }, async (req) => {
    const { id } = idParam.parse(req.params);
    const plans = await prisma.cleaningPlan.findMany({
      where: { machineId: id },
      include: { steps: { orderBy: { order: 'asc' } } },
      orderBy: { id: 'asc' },
    });
    return plans.map((p) => ({
      ...p,
      weekdays: p.weekdays.split(',').filter(Boolean).map(Number),
      strictDays: p.strictDays.split(',').filter(Boolean).map(Number),
    }));
  });

  app.post('/machines/:id/plans', { preHandler: requireAdmin }, async (req) => {
    const { id } = idParam.parse(req.params);
    const data = planSchema.parse(req.body);
    const plan = await prisma.cleaningPlan.create({
      data: {
        machineId: id,
        name: data.name,
        weekdays: data.weekdays,
        strictDays: data.strictDays,
        active: data.active,
        steps: { create: data.steps.map((s, i) => ({ ...s, order: i + 1 })) },
      },
    });
    await audit(req.currentUser!.id, 'PLAN_CREATE', { machineId: id, planId: plan.id });
    return plan;
  });

  app.put('/plans/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = idParam.parse(req.params);
    const data = planSchema.parse(req.body);
    const plan = await prisma.$transaction(async (tx) => {
      await tx.planStep.deleteMany({ where: { planId: id } });
      return tx.cleaningPlan.update({
        where: { id },
        data: {
          name: data.name,
          weekdays: data.weekdays,
          strictDays: data.strictDays,
          active: data.active,
          steps: { create: data.steps.map((s, i) => ({ ...s, order: i + 1 })) },
        },
      });
    });
    await audit(req.currentUser!.id, 'PLAN_UPDATE', { planId: id });
    return plan;
  });

  app.delete('/plans/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = idParam.parse(req.params);
    await prisma.cleaningPlan.delete({ where: { id } });
    await audit(req.currentUser!.id, 'PLAN_DELETE', { planId: id });
    return { ok: true };
  });
}
