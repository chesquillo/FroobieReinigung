import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@prisma/client';
import { prisma } from './lib.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { uid: number };
    user: { uid: number };
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: User;
  }
}

export const COOKIE_NAME = 'froobie_session';

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'UNAUTHORIZED' });
  }
  const user = await prisma.user.findUnique({ where: { id: req.user.uid } });
  if (!user || !user.active) {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return reply.code(401).send({ error: 'UNAUTHORIZED' });
  }
  req.currentUser = user;
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  await requireAuth(req, reply);
  if (reply.sent) return;
  if (req.currentUser?.role !== 'ADMIN') {
    return reply.code(403).send({ error: 'FORBIDDEN' });
  }
}

export function publicUser(u: User) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    language: u.language,
    active: u.active,
    createdAt: u.createdAt,
  };
}
