import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export default function setup() {
  const db = path.resolve('prisma/test.db');
  for (const f of [db, db + '-journal']) if (fs.existsSync(f)) fs.rmSync(f);
  const env = { ...process.env, DATABASE_URL: 'file:./test.db', ADMIN_INITIAL_PASSWORD: 'test-admin-pass' };
  execSync('npx prisma migrate deploy', { env, stdio: 'ignore' });
  execSync('npx tsx prisma/seed.ts', { env, stdio: 'ignore' });
}
