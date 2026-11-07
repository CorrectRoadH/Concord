import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const mock = process.versions.bun === undefined ? undefined : (await import('bun:test')).mock;

/** Publish test-owned builtin replacements to the live imports used by Bun. */
export function syncBuiltinMocks(): void {
  if (mock === undefined) { syncBuiltinESMExports(); return; }
  mock.module('node:fs', () => ({ ...fs, default: fs }));
  mock.module('node:child_process', () => ({ ...childProcess, default: childProcess }));
}
