import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import '../support/source-consumer.ts';
import { runCli } from '../support/cli.ts';
import { tmpdir } from '../support/temporary.ts';

// @feature docs/feature/local-sdlc/library.md
test('source CLI doctor reports a library mismatch and keeps its successful exit', () => Effect.runPromise(Effect.promise(async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-cli-library-version-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    mkdirSync(join(root, 'node_modules/concord-sdlc'), { recursive: true });
    writeFileSync(join(root, 'node_modules/concord-sdlc/package.json'), '{"version":"0.0.0"}');
    const result = await runCli({ argv: ['--json', 'doctor', '--root', root], cwd: process.cwd(), env: process.env });
    assert.equal(result.exitCode, 0, result.stderr);
    const diagnosis = JSON.parse(result.stdout);
    assert.equal(diagnosis.ok, true);
    assert.equal(diagnosis.nextSteps[0], 'concord init');
    assert.equal(diagnosis.findings.filter((finding: { code: string }) => finding.code === 'LibraryVersionMismatch').length, 1);
    assert.match(diagnosis.nextSteps.at(-1), /^npm install -D https:\/\/github.com\/CorrectRoadH\/Concord\/releases\/download\/v[^/]+\/concord-sdlc-[^/]+\.tgz$/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
