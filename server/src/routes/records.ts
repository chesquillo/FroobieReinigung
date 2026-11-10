import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../auth.js';
import { prisma, stepText, todayStr } from '../lib.js';
import { isStrictOn, planAppliesOn, stepsFor } from '../services.js';

const createSchema = z.object({
  machineId: z.number().int(),
  planId: z.number().int(),
  startedAt: z.coerce.date().optional(),
  steps: z.array(z.object({ stepId: z.number().int(), checked: z.boolean() })),
  comment: z.string().trim().max(2000).optional().default(''),
  signature: z
    .string()
    .max(400_000, 'SIGNATURE_TOO_LARGE')
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'SIGNATURE_REQUIRED'),
  incidentIds: z.array(z.number().int()).default([]),
});

const filterSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  machineId: z.coerce.number().int().optional(),
  userId: z.coerce.number().int().optional(),
});

export function recordWhere(f: z.infer<typeof filterSchema>) {
  return {
    ...(f.machineId ? { machineId: f.machineId } : {}),
    ...(f.userId ? { userId: f.userId } : {}),
    ...(f.from || f.to ? { date: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
  };
}

export { filterSchema };

export default async function recordRoutes(app: FastifyInstance) {
  app.post('/records', { preHandler: requireAuth }, async (req, reply) => {
    const data = createSchema.parse(req.body);
    const me = req.currentUser!;
    const date = todayStr();

    const plan = await prisma.cleaningPlan.findUnique({
      where: { id: data.planId },
      include: { steps: true, machine: true },
    });
    if (!plan || plan.machineId !== data.machineId) return reply.code(404).send({ error: 'PLAN_NOT_FOUND' });
    if (!planAppliesOn(plan, date)) return reply.code(400).send({ error: 'NOT_SCHEDULED_TODAY' });

    const existing = await prisma.cleaningRecord.findFirst({ where: { planId: plan.id, date } });
    if (existing) return reply.code(409).send({ error: 'ALREADY_DONE' });

    const expected = stepsFor(plan, date);
    const checkedMap = new Map(data.steps.map((s) => [s.stepId, s.checked]));
    const missing = expected.filter((s) => !checkedMap.get(s.id));
    if (missing.length > 0 && !data.comment && data.incidentIds.length === 0) {
      return reply.code(400).send({ error: 'UNCHECKED_STEPS_NEED_COMMENT' });
    }

    // Las incidencias deben ser de esta máquina, del mismo usuario y aún sin vincular
    const incidents = data.incidentIds.length
      ? await prisma.incident.findMany({
          where: { id: { in: data.incidentIds }, machineId: plan.machineId, userId: me.id, recordId: null },
        })
      : [];

    const status = missing.length > 0 || incidents.length > 0 ? 'WITH_ISSUES' : 'OK';
    const record = await prisma.cleaningRecord.create({
      data: {
        machineId: plan.machineId,
        planId: plan.id,
        userId: me.id,
        date,
        startedAt: data.startedAt,
        wasStrict: isStrictOn(plan, date),
        signature: data.signature,
        comment: data.comment || null,
        status,
        steps: {
          // El texto se guarda en alemán (idioma de referencia de los informes)
          create: expected.map((s) => ({ stepId: s.id, text: stepText(s, 'de'), checked: !!checkedMap.get(s.id) })),
        },
      },
    });
    if (incidents.length) {
      await prisma.incident.updateMany({
        where: { id: { in: incidents.map((i) => i.id) } },
        data: { recordId: record.id },
      });
    }
    return { id: record.id, status };
  });

  app.get('/records/mine', { preHandler: requireAuth }, async (req) => {
    const records = await prisma.cleaningRecord.findMany({
      where: { userId: req.currentUser!.id },
      include: { machine: { select: { number: true, name: true } }, _count: { select: { incidents: true } } },
      orderBy: { completedAt: 'desc' },
      take: 100,
    });
    return records.map(({ signature: _s, ...r }) => r);
  });

  app.get('/records', { preHandler: requireAdmin }, async (req) => {
    const f = filterSchema.parse(req.query);
    const records = await prisma.cleaningRecord.findMany({
      where: recordWhere(f),
      include: {
        machine: { select: { number: true, name: true } },
        user: { select: { fullName: true, username: true } },
        _count: { select: { incidents: true } },
      },
      orderBy: { completedAt: 'desc' },
      take: 500,
    });
    return records.map(({ signature: _s, ...r }) => r);
  });

  app.get('/records/:id', { preHandler: requireAuth }, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const r = await prisma.cleaningRecord.findUnique({
      where: { id },
      include: {
        machine: true,
        user: { select: { fullName: true, username: true } },
        plan: { select: { name: true } },
        steps: { include: { step: true } },
        incidents: true,
      },
    });
    if (!r) return reply.code(404).send({ error: 'NOT_FOUND' });
    const me = req.currentUser!;
    if (me.role !== 'ADMIN' && r.userId !== me.id) return reply.code(403).send({ error: 'FORBIDDEN' });
    return {
      ...r,
      machine: { ...r.machine, qrToken: undefined },
      steps: r.steps.map((s) => ({ id: s.id, checked: s.checked, text: s.step ? stepText(s.step, me.language) : s.text })),
    };
  });
}
