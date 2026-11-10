import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import { audit, prisma } from '../lib.js';

const schema = z.object({
  machineId: z.number().int(),
  type: z.enum(['UPDATE', 'REPAIR', 'MAINTENANCE']),
  description: z.string().trim().min(3).max(4000),
  technician: z.string().trim().max(100).optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cost: z.number().nonnegative().optional().nullable(),
});

export default async function maintenanceRoutes(app: FastifyInstance) {
  app.get('/maintenance', { preHandler: requireAdmin }, async (req) => {
    const q = z.object({ machineId: z.coerce.number().int().optional() }).parse(req.query);
    return prisma.maintenanceLog.findMany({
      where: q.machineId ? { machineId: q.machineId } : {},
      include: { machine: { select: { number: true, name: true } }, user: { select: { fullName: true } } },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: 300,
    });
  });

  app.post('/maintenance', { preHandler: requireAdmin }, async (req) => {
    const data = schema.parse(req.body);
    const log = await prisma.maintenanceLog.create({ data: { ...data, userId: req.currentUser!.id } });
    await audit(req.currentUser!.id, 'MAINTENANCE_CREATE', { id: log.id, machineId: data.machineId });
    return log;
  });

  app.put('/maintenance/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const data = schema.parse(req.body);
    return prisma.maintenanceLog.update({ where: { id }, data });
  });

  app.delete('/maintenance/:id', { preHandler: requireAdmin }, async (req) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    await prisma.maintenanceLog.delete({ where: { id } });
    await audit(req.currentUser!.id, 'MAINTENANCE_DELETE', { id });
    return { ok: true };
  });
}
