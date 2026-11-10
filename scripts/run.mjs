// Elige automáticamente modo local (SQLite) o nube (Render + Supabase).
// Uso: node scripts/run.mjs build|start
import { execSync } from 'node:child_process';

const cmd = process.argv[2];
const cloud = !!process.env.RENDER || /^postgres(ql)?:/.test(process.env.DATABASE_URL ?? '');
const run = (c) => execSync(c, { stdio: 'inherit' });

if (cloud && cmd === 'start') {
  const required = ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_INITIAL_PASSWORD', 'JWT_SECRET'];
  const missing = required.filter((k) => !process.env[k]);
  const db = process.env.DATABASE_URL ?? '';
  const problems = [];
  if (missing.length) problems.push(`Faltan variables de entorno en Render: ${missing.join(', ')}`);
  if (db && !/^postgres(ql)?:\/\//.test(db)) problems.push('DATABASE_URL debe empezar por postgresql:// (Supabase → Connect → Session pooler)');
  if (/\[YOUR-PASSWORD\]|\[PASSWORD\]/i.test(db)) problems.push('DATABASE_URL todavía contiene [YOUR-PASSWORD]: pon tu contraseña de la base de datos');
  if ((process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').startsWith('sb_publishable_'))
    problems.push('SUPABASE_SERVICE_ROLE_KEY es la clave pública (sb_publishable_…): usa la secreta (sb_secret_…)');
  if (problems.length) {
    console.error('\n❌ Froobie no puede arrancar:\n  - ' + problems.join('\n  - ') + '\n  Añádelas en Render → tu servicio → Environment → Save, y vuelve a desplegar.\n');
    process.exit(1);
  }
}

console.log(`▶ Froobie ${cmd} en modo ${cloud ? 'NUBE (Render + Supabase)' : 'LOCAL (SQLite)'}`);
if (cmd === 'build') run(cloud ? 'npm run cloud:build' : 'npm --prefix web run build && npm --prefix server run build');
else if (cmd === 'start') run(cloud ? 'npm run cloud:start' : 'npm --prefix server run start');
else throw new Error('Uso: node scripts/run.mjs build|start');
