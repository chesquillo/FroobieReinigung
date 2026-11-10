import { seed } from '../src/seed.js';
import { prisma } from '../src/lib.js';

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
