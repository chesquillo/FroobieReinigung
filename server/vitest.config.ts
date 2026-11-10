import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './test/global-setup.ts',
    env: {
      DATABASE_URL: 'file:./test.db',
      JWT_SECRET: 'test-secret',
      ADMIN_INITIAL_PASSWORD: 'test-admin-pass',
      FAKE_TODAY: '2026-11-13', // viernes
      PUBLIC_URL: 'http://test.local',
    },
    fileParallelism: false,
  },
});
