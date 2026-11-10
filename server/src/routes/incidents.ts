import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../auth.js';
import { audit, prisma } from '../lib.js';
import { saveUploadedImage } from '../services.js';

export default async function incidentRoutes(app: FastifyInstance) {
  // Reportar incidencia (multipart: photo + machineId + description + severity). La foto es obligatoria.
  app.post('/incidents', { preHandler: requireAuth }, async (req, reply) => {
    const { url, fields } = await saveUploadedImage(req, 'incident');
    if (!url) return reply.code(400).send({ error: 'PHOTO_REQUIRED' });
    const data = z
      .object({
        machineId: z.coerce.number().int(),
        description: z.string().trim().min(3).max(2000),
        severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
      })
      .parse(fields);
    const machine = await prisma.machine.findUnique({ where: { id: data.machineId } });
    if (!machine) return reply.code(404).send({ error: 'MACHINE_NOT_FOUND' });
    return prisma.incident.create({
      data: { ...data, photoUrl: url, userId: req.currentUser!.id },
    });
  });

  app.get('/incidents', { preHandler: requireAdmin }, async (req) => {
    const q = z
      .object({ status: z.enum(['open', 'resolved', 'all']).default('open'), machineId: z.coerce.number().int().optional() })
      .parse(req.query);
    return prisma.incident.findMany({
      where: {
        ...(q.status === 'all' ? {} : { resolved: q.status === 'resolved' }),
        ...(q.machineId ? { machineId: q.machineId } : {}),
      },
      include: { machine: { select: { number: true, name: true } }, user: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  });

  app.patch('/incidents/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const data = z
      .object({ resolved: z.boolean(), resolution: z.string().trim().max(2000).optional() })
      .parse(req.body);
    const inc = await prisma.incident.update({
      where: { id },
      data: {
        resolved: data.resolved,
        resolution: data.resolution ?? null,
        resolvedAt: data.resolved ? new Date() : null,
      },
    });
    await audit(req.currentUser!.id, data.resolved ? 'INCIDENT_RESOLVE' : 'INCIDENT_REOPEN', { id });
    return inc;
  });
}
