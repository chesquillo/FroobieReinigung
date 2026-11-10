import os from 'node:os';
import { buildApp } from './app.js';
import { config } from './lib.js';
import { seed } from './seed.js';

await seed();

const app = await buildApp({ logger: true });
await app.listen({ port: config.port, host: '0.0.0.0' });

const ips = Object.values(os.networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal)
  .map((i) => i!.address);
console.log(`\n🍦 Froobie API escuchando en el puerto ${config.port}`);
for (const ip of ips) console.log(`   Red local: http://${ip}:${config.port}`);
