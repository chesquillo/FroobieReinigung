import type { FastifyInstance, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { COOKIE_NAME, publicUser, requireAuth } from '../auth.js';
import { LANGS, prisma } from '../lib.js';

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,30}$/, 'INVALID_USERNAME');
export const gmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._%+-]+@(gmail|googlemail)\.com$/, 'GMAIL_REQUIRED');
export const passwordSchema = z.string().min(8, 'PASSWORD_TOO_SHORT').max(100);

const registerSchema = z.object({
  username: usernameSchema,
  fullName: z.string().trim().min(2).max(80),
  email: gmailSchema,
  password: passwordSchema,
  language: z.enum(LANGS).default('de'),
});

const loginSchema = z.object({ username: z.string().trim().toLowerCase(), password: z.string() });

const updateMeSchema = z.object({
  language: z.enum(LANGS).optional(),
  fullName: z.string().trim().min(2).max(80).optional(),
  currentPassword: z.string().optional(),
  newPassword: passwordSchema.optional(),
});

async function setSession(app: FastifyInstance, reply: FastifyReply, uid: number) {
  const token = await reply.jwtSign({ uid });
  reply.setCookie(COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    maxAge: 14 * 24 * 3600,
  });
}

export default async function authRoutes(app: FastifyInstance) {
  const limited = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.post('/auth/register', limited, async (req, reply) => {
    const data = registerSchema.parse(req.body);
    const exists = await prisma.user.findFirst({
      where: { OR: [{ username: data.username }, { email: data.email }] },
    });
    if (exists) {
      return reply
        .code(409)
        .send({ error: exists.username === data.username ? 'USERNAME_TAKEN' : 'EMAIL_TAKEN' });
    }
    const user = await prisma.user.create({
      data: {
        username: data.username,
        fullName: data.fullName,
        email: data.email,
        language: data.language,
        passwordHash: await bcrypt.hash(data.password, 10),
      },
    });
    await setSession(app, reply, user.id);
    return publicUser(user);
  });

  app.post('/auth/login', limited, async (req, reply) => {
    const { username, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findFirst({
      where: { OR: [{ username }, { email: username }] },
    });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
    }
    if (!user.active) return reply.code(403).send({ error: 'USER_DISABLED' });
    await setSession(app, reply, user.id);
    return publicUser(user);
  });

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (req) => publicUser(req.currentUser!));

  app.patch('/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    const data = updateMeSchema.parse(req.body);
    const me = req.currentUser!;
    const update: Record<string, unknown> = {};
    if (data.language) update.language = data.language;
    if (data.fullName) update.fullName = data.fullName;
    if (data.newPassword) {
      if (!data.currentPassword || !(await bcrypt.compare(data.currentPassword, me.passwordHash))) {
        return reply.code(400).send({ error: 'WRONG_PASSWORD' });
      }
      update.passwordHash = await bcrypt.hash(data.newPassword, 10);
    }
    const user = await prisma.user.update({ where: { id: me.id }, data: update });
    return publicUser(user);
  });
}
