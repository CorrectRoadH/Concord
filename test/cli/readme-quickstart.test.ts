import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { runCli } from '../support/cli.ts';

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('the code skill exposes the README quick start code-location command', () => Effect.runPromise(Effect.promise(async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-code-cli-'));
  try {
    const skill = await runCli({ argv: ['--skill', 'code'], cwd: scratch, env: process.env, signal: AbortSignal.timeout(10000) });
    assert.equal(skill.exitCode, 0, skill.stderr); assert.match(skill.stdout, /code at/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
})));
