import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Schema } from 'effect';
import { runCli } from '../support/cli.ts';

// @use-case docs/feature/local-sdlc/use-case/onboard-from-template.md
test('version output matches the checkout package version', async () => {
  const version = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ version: Schema.String })))(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  const result = await runCli({ argv: ['--version'], cwd: process.cwd(), env: process.env, stdin: '' });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.trim(), `concord v${version}`);
});
