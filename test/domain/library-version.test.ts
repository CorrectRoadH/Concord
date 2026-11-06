import { createConsumer } from '../support/consumer.ts';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { doctor, uninitializedDoctor } from '../../src/app/index.ts';
import { LocalRepository } from '../support/repository.ts';
import { tmpdir } from '../support/temporary.ts';

const cliVersion = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version as string;

// @feature docs/feature/local-sdlc/library.md
test('doctor diagnoses installed library versions without changing project health', () => Effect.runPromise(Effect.sync(() => {
  const root = createConsumer();
  const repo = new LocalRepository(root);
  try {
    const baseline = doctor(repo);
    assert.equal(baseline.findings.some(finding => finding.code === 'LibraryVersionMismatch'), false);
    const manifest = join(root, 'node_modules/concord-sdlc/package.json');
    mkdirSync(join(root, 'node_modules/concord-sdlc'), { recursive: true });
    writeFileSync(manifest, JSON.stringify({ version: cliVersion }));
    assert.deepEqual(doctor(repo), baseline);
    // Reading metadata must not execute the library's entrypoint.
    writeFileSync(join(root, 'node_modules/concord-sdlc/index.js'), 'throw new Error("must not load");');
    writeFileSync(manifest, JSON.stringify({ version: '0.0.0', main: 'index.js' }));
    const result = doctor(repo);
    assert.equal(result.ok, baseline.ok);
    assert.deepEqual(result.findings.filter(finding => finding.code === 'LibraryVersionMismatch'), [{
      code: 'LibraryVersionMismatch', path: 'node_modules/concord-sdlc/package.json',
      message: `concord-sdlc 0.0.0 does not match Concord ${cliVersion}. Run: npm install -D https://github.com/CorrectRoadH/Concord/releases/download/v${cliVersion}/concord-sdlc-${cliVersion}.tgz`,
    }]);
    assert.deepEqual(result.nextSteps.slice(0, -1), baseline.nextSteps);
    assert.equal(result.nextSteps.at(-1), `npm install -D https://github.com/CorrectRoadH/Concord/releases/download/v${cliVersion}/concord-sdlc-${cliVersion}.tgz`);
  } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
})));

// @feature docs/feature/local-sdlc/library.md
test('uninitialized doctor preserves init as the first step alongside a library mismatch', () => Effect.runPromise(Effect.sync(() => {
  // Doctor's uninitialized input is the subject, so this directory has no consumer template.
  const root = mkdtempSync(join(tmpdir(), 'concord-library-uninitialized-'));
  try {
    mkdirSync(join(root, 'node_modules/concord-sdlc'), { recursive: true });
    writeFileSync(join(root, 'node_modules/concord-sdlc/package.json'), '{"version":"0.0.0"}');
    const result = uninitializedDoctor({ root, guide: 'docs-from-code' }, process.version);
    assert.equal(result.ok, true);
    assert.equal(result.nextSteps[0], 'concord init');
    assert.deepEqual(result.findings.map(finding => finding.code), ['ProjectNotInitialized', 'LibraryVersionMismatch']);
  } finally { rmSync(root, { recursive: true, force: true }); }
})));
