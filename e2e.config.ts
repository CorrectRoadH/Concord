import type { E2EConfig } from 'e2e';
import { engine } from './test/e2e/engine.js';

export default {
  tests: 'test/e2e/*.e2e.ts',
  // Each test opens its own ephemeral View address; no shared application server.
  targets: [{ name: 'chromium', engine, app: { url: 'http://127.0.0.1' } }],
  workers: 1,
  retries: 0,
  timeout: 180_000,
  cleanupTimeout: 30_000,
  assertionTimeout: 15_000,
  cache: 'off',
  trace: 'retain-on-failure',
  reporters: ['list', 'markdown'],
  output: process.env.CONCORD_E2E_OUTPUT ?? '.e2e',
} satisfies E2EConfig;
