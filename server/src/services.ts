import type { FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import type { CleaningPlan, PlanStep } from '@prisma/client';
import { isoWeekday, parseDays, prisma, stepText, timeInTz } from './lib.js';
import { saveFile } from './storage.js';

export function newQrToken() {
  return crypto.randomBytes(12).toString('base64url');
}

const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Guarda la imagen subida (multipart) y devuelve su URL pública + los campos de texto. */
export async function saveUploadedImage(req: FastifyRequest, prefix: string) {
  const fields: Record<string, string> = {};
  let url: string | null = null;
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const ext = IMAGE_EXT[part.mimetype];
      if (!ext) {
        part.file.resume();
        throw Object.assign(new Error('INVALID_IMAGE'), { statusCode: 400 });
      }
      const buf = await part.toBuffer();
      const name = `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      url = await saveFile(name, buf, part.mimetype);
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }
  return { url, fields };
}

export function planAppliesOn(plan: CleaningPlan, date: string) {
  return plan.active && parseDays(plan.weekdays).includes(isoWeekday(date));
}

export function isStrictOn(plan: CleaningPlan, date: string) {
  return parseDays(plan.strictDays).includes(isoWeekday(date));
}

export function stepsFor(plan: CleaningPlan & { steps: PlanStep[] }, date: string) {
  const strict = isStrictOn(plan, date);
  return plan.steps
    .filter((s) => strict || !s.onlyStrictDays)
    .sort((a, b) => a.order - b.order);
}

/** Tareas de limpieza de una máquina para una fecha, con su estado. */
export async function machineTasks(machineId: number, date: string, lang: string) {
  const plans = await prisma.cleaningPlan.findMany({
    where: { machineId, active: true },
    include: { steps: true },
    orderBy: { id: 'asc' },
  });
  const records = await prisma.cleaningRecord.findMany({
    where: { machineId, date },
    include: { user: true },
    orderBy: { completedAt: 'asc' },
  });
  return plans
    .filter((p) => planAppliesOn(p, date))
    .map((p) => {
      const done = records.find((r) => r.planId === p.id);
      return {
        planId: p.id,
        planName: p.name,
        strict: isStrictOn(p, date),
        steps: stepsFor(p, date).map((s) => ({
          id: s.id,
          text: stepText(s, lang),
          onlyStrictDays: s.onlyStrictDays,
        })),
        done: done
          ? {
              recordId: done.id,
              by: done.user.fullName,
              time: timeInTz(done.completedAt),
              status: done.status,
            }
          : null,
      };
    });
}
