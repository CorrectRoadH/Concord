import type { E2EConfig } from 'e2e';
import { browserTestReport } from './scripts/browser-test-report.js';
import { engine } from './test/e2e/engine.js';

export default {
  tests: 'test/e2e/*.e2e.ts',
  // The engine owns one temporary repository and View service per worker.
  targets: [{ name: 'chromium', engine, app: { url: 'http://127.0.0.1' } }],
  workers: 1,
  retries: 0,
  timeout: 180_000,
  cleanupTimeout: 30_000,
  assertionTimeout: 15_000,
  cache: 'off',
  trace: 'retain-on-failure',
  reporters: ['list', 'markdown', browserTestReport],
  output: process.env.CONCORD_E2E_OUTPUT ?? '.e2e',
} satisfies E2EConfig;
