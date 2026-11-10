import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import { addDays, dateInTz, LANGS, prisma, todayStr, timeInTz, type Lang } from '../lib.js';
import { isStrictOn, machineTasks, planAppliesOn } from '../services.js';
import {
  cleaningReportPdf,
  complianceReportPdf,
  incidentReportPdf,
  maintenanceReportPdf,
  type ReportMeta,
} from '../pdf/reports.js';

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const reportQuery = z.object({
  from: z.string().regex(dateRe).optional(),
  to: z.string().regex(dateRe).optional(),
  machineId: z.coerce.number().int().optional(),
  lang: z.enum(LANGS).optional(),
});

async function compliance(from: string, to: string, machineId?: number) {
  const today = todayStr();
  const end = to > today ? today : to;
  const plans = await prisma.cleaningPlan.findMany({
    where: machineId ? { machineId } : {},
    include: { machine: true },
  });
  const records = await prisma.cleaningRecord.findMany({
    where: { date: { gte: from, lte: end }, ...(machineId ? { machineId } : {}) },
    select: { planId: true, date: true },
  });
  const doneSet = new Set(records.map((r) => `${r.planId}|${r.date}`));
  const per = new Map<number, { label: string; number: number; scheduled: number; done: number }>();
  const missed: { date: string; label: string; plan: string; strict: boolean }[] = [];
  let days = 0;
  for (let d = from; d <= end && days < 400; d = addDays(d, 1), days++) {
    for (const p of plans) {
      if (!planAppliesOn(p, d)) continue;
      if (d < dateInTz(p.createdAt)) continue; // la orden aún no existía
      const isDone = doneSet.has(`${p.id}|${d}`);
      if (d === today && !isDone) continue; // hoy todavía se puede hacer: no cuenta como no realizada
      const label = `Nº${p.machine.number} ${p.machine.name}`;
      const e = per.get(p.machineId) ?? { label, number: p.machine.number, scheduled: 0, done: 0 };
      e.scheduled++;
      if (isDone) e.done++;
      else missed.push({ date: d, label, plan: p.name, strict: isStrictOn(p, d) });
      per.set(p.machineId, e);
    }
  }
  return {
    perMachine: [...per.values()].sort((a, b) => a.number - b.number),
    missed: missed.sort((a, b) => b.date.localeCompare(a.date)),
  };
}

function csvCell(v: unknown) {
  const s = v == null ? '' : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default async function reportRoutes(app: FastifyInstance) {
  app.get('/dashboard', { preHandler: requireAdmin }, async (req) => {
    const date = todayStr();
    const machines = await prisma.machine.findMany({ orderBy: { number: 'asc' } });
    const today = await Promise.all(
      machines.map(async (m) => ({
        id: m.id,
        number: m.number,
        name: m.name,
        status: m.status,
        photoUrl: m.photoUrl,
        tasks: await machineTasks(m.id, date, req.currentUser!.language),
      })),
    );
    const week = await compliance(addDays(date, -6), date);
    const [openIncidents, workers, recent] = await Promise.all([
      prisma.incident.count({ where: { resolved: false } }),
      prisma.user.count({ where: { active: true, role: 'WORKER' } }),
      prisma.cleaningRecord.findMany({
        include: { machine: { select: { number: true, name: true } }, user: { select: { fullName: true } } },
        orderBy: { completedAt: 'desc' },
        take: 8,
      }),
    ]);
    const sched = week.perMachine.reduce((a, m) => a + m.scheduled, 0);
    const done = week.perMachine.reduce((a, m) => a + m.done, 0);
    return {
      date,
      today,
      openIncidents,
      workers,
      week: { scheduled: sched, done, missed: week.missed.slice(0, 10) },
      recent: recent.map((r) => ({
        id: r.id,
        date: r.date,
        time: timeInTz(r.completedAt),
        machine: `Nº${r.machine.number} ${r.machine.name}`,
        user: r.user.fullName,
        status: r.status,
        wasStrict: r.wasStrict,
      })),
    };
  });

  app.get('/reports/:type', { preHandler: requireAdmin }, async (req, reply) => {
    const { type } = z
      .object({ type: z.enum(['cleaning.pdf', 'incidents.pdf', 'maintenance.pdf', 'compliance.pdf', 'cleaning.csv']) })
      .parse(req.params);
    const q = reportQuery.parse(req.query);
    const to = q.to ?? todayStr();
    const from = q.from ?? addDays(to, -30);
    const lang = (q.lang ?? req.currentUser!.language) as Lang;
    const machine = q.machineId ? await prisma.machine.findUnique({ where: { id: q.machineId } }) : null;
    const meta: ReportMeta = {
      lang,
      from,
      to,
      machineLabel: machine ? `Nº${machine.number} ${machine.name}` : null,
      generatedBy: req.currentUser!.fullName,
    };
    const mFilter = q.machineId ? { machineId: q.machineId } : {};
    const fileBase = `Froobie-${type.split('.')[0]}-${from}_${to}`;

    if (type === 'cleaning.pdf' || type === 'cleaning.csv') {
      const rows = await prisma.cleaningRecord.findMany({
        where: { ...mFilter, date: { gte: from, lte: to } },
        include: {
          machine: { select: { number: true, name: true } },
          user: { select: { fullName: true } },
          plan: { select: { name: true } },
          steps: { include: { step: true }, orderBy: { id: 'asc' } },
          incidents: { select: { description: true, severity: true } },
        },
        orderBy: [{ date: 'asc' }, { completedAt: 'asc' }],
      });
      const stepTxt = (s: (typeof rows)[number]['steps'][number]) =>
        s.step ? (lang === 'en' ? s.step.textEn : lang === 'es' ? s.step.textEs : s.step.textDe) : s.text;

      if (type === 'cleaning.csv') {
        const head = ['date', 'time', 'machine_no', 'machine', 'worker', 'plan', 'deep_cleaning', 'status', 'steps_ok', 'steps_total', 'incidents', 'comment'];
        const lines = rows.map((r) =>
          [
            r.date,
            timeInTz(r.completedAt),
            r.machine.number,
            r.machine.name,
            r.user.fullName,
            r.plan?.name ?? '',
            r.wasStrict ? 'yes' : 'no',
            r.status,
            r.steps.filter((s) => s.checked).length,
            r.steps.length,
            r.incidents.length,
            r.comment ?? '',
          ]
            .map(csvCell)
            .join(';'),
        );
        return reply
          .type('text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${fileBase}.csv"`)
          .send('﻿' + [head.join(';'), ...lines].join('\n'));
      }

      const pdf = await cleaningReportPdf(
        rows.map((r) => ({
          date: r.date,
          completedAt: r.completedAt,
          machine: r.machine,
          user: r.user,
          planName: r.plan?.name ?? '—',
          wasStrict: r.wasStrict,
          status: r.status,
          comment: r.comment,
          signature: r.signature,
          steps: r.steps.map((s) => ({ text: stepTxt(s), checked: s.checked })),
          incidents: r.incidents,
        })),
        meta,
      );
      return sendPdf(reply, pdf, fileBase);
    }

    if (type === 'incidents.pdf') {
      const rows = await prisma.incident.findMany({
        where: {
          ...mFilter,
          createdAt: { gte: new Date(from + 'T00:00:00Z'), lte: new Date(addDays(to, 1) + 'T00:00:00Z') },
        },
        include: { machine: { select: { number: true, name: true } }, user: { select: { fullName: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return sendPdf(reply, await incidentReportPdf(rows, meta), fileBase);
    }

    if (type === 'maintenance.pdf') {
      const rows = await prisma.maintenanceLog.findMany({
        where: { ...mFilter, date: { gte: from, lte: to } },
        include: { machine: { select: { number: true, name: true } } },
        orderBy: { date: 'asc' },
      });
      return sendPdf(reply, await maintenanceReportPdf(rows, meta), fileBase);
    }

    const data = await compliance(from, to, q.machineId);
    return sendPdf(reply, await complianceReportPdf(data, meta), fileBase);
  });
}

function sendPdf(reply: import('fastify').FastifyReply, pdf: Buffer, name: string) {
  return reply
    .type('application/pdf')
    .header('Content-Disposition', `attachment; filename="${name}.pdf"`)
    .send(pdf);
}
