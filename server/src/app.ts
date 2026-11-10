import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import { requireAuth } from './auth.js';
import { contentTypeOf, initStorage, readFile, safeName } from './storage.js';
import { ZodError } from 'zod';
import { COOKIE_NAME } from './auth.js';
import { config, WEB_DIST } from './lib.js';
import authRoutes from './routes/auth.js';
import machineRoutes from './routes/machines.js';
import recordRoutes from './routes/records.js';
import incidentRoutes from './routes/incidents.js';
import maintenanceRoutes from './routes/maintenance.js';
import userRoutes from './routes/users.js';
import reportRoutes from './routes/reports.js';

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 2 * 1024 * 1024, trustProxy: true });

  await app.register(cookie);
  await app.register(jwt, {
    secret: config.jwtSecret,
    cookie: { cookieName: COOKIE_NAME, signed: false },
    sign: { expiresIn: '14d' },
  });
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'VALIDATION', issues: err.issues });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? 'SERVER_ERROR' : (err as Error).message });
  });

  app.get('/api/health', async () => ({ ok: true }));

  // Fotos (máquinas e incidencias): solo para usuarios con sesión
  await initStorage();
  app.get('/uploads/:name', { preHandler: requireAuth }, async (req, reply) => {
    const name = safeName((req.params as { name: string }).name);
    const data = name ? await readFile(`/uploads/${name}`) : null;
    if (!data) return reply.code(404).send({ error: 'NOT_FOUND' });
    return reply.type(contentTypeOf(name!)).header('Cache-Control', 'private, max-age=86400').send(data);
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(machineRoutes);
      await api.register(recordRoutes);
      await api.register(incidentRoutes);
      await api.register(maintenanceRoutes);
      await api.register(userRoutes);
      await api.register(reportRoutes);
    },
    { prefix: '/api' },
  );

  // En producción el servidor también entrega la app web compilada.
  if (fs.existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, { root: WEB_DIST, prefix: '/', wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/uploads')) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }
      return reply.sendFile('index.html', WEB_DIST);
    });
  }

  return app;
}
