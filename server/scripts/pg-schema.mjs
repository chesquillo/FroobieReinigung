// Genera prisma/postgres.prisma (para Supabase/PostgreSQL) a partir de prisma/schema.prisma (SQLite local).
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const out = src.replace('provider = "sqlite"', 'provider = "postgresql"');
if (out === src) throw new Error('No se encontró provider sqlite en schema.prisma');
fs.writeFileSync(new URL('../prisma/postgres.prisma', import.meta.url), '// ARCHIVO GENERADO por scripts/pg-schema.mjs — no editar\n' + out);
console.log('✔ prisma/postgres.prisma generado');
