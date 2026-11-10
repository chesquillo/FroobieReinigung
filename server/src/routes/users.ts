import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { publicUser, requireAdmin } from '../auth.js';
import { audit, LANGS, prisma } from '../lib.js';
import { passwordSchema } from './auth.js';

export default async function userRoutes(app: FastifyInstance) {
  app.get('/users', { preHandler: requireAdmin }, async () => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { records: true } } },
    });
    return users.map((u) => ({ ...publicUser(u), records: u._count.records }));
  });

  app.patch('/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const data = z
      .object({
        active: z.boolean().optional(),
        role: z.enum(['ADMIN', 'WORKER']).optional(),
        language: z.enum(LANGS).optional(),
        newPassword: passwordSchema.optional(),
      })
      .parse(req.body);
    if (id === req.currentUser!.id && (data.active === false || data.role === 'WORKER')) {
      return reply.code(400).send({ error: 'CANNOT_DEMOTE_SELF' });
    }
    const { newPassword, ...rest } = data;
    const user = await prisma.user.update({
      where: { id },
      data: { ...rest, ...(newPassword ? { passwordHash: await bcrypt.hash(newPassword, 10) } : {}) },
    });
    await audit(req.currentUser!.id, 'USER_UPDATE', { id, ...rest, passwordReset: !!newPassword });
    return publicUser(user);
  });
}
