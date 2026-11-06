import { createDocument, initialize } from '../support/operations.js';
import { packageBin } from '../support/installed-package.js';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs, { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from '../support/temporary.js';
import { join, resolve } from 'node:path';
import test, { before, after } from 'node:test';
import { prepareSourceConsumer, sourceConcord } from '../support/installed-package.js';
import { Effect, Schema } from 'effect';
import { extractSteps } from "../../src/domain/documents/index.js";
import { formatUseCase, renameUseCaseStep, useCaseSteps } from "../../src/app/index.js";
import { planStepRename } from "../../src/app/index.js";
import { loadDocuments } from "../../src/domain/documents/index.js";

import { renderDocument } from "../../src/model/index.js";
import { LocalRepository } from "../support/repository.js";

import { buildTrace } from "../../src/domain/trace/index.js";
import { renderReview, traceGaps, traceShow } from "../../src/app/index.js";
import { clearCache, parseTestDeclarations } from "../../src/domain/tests/index.js";
import { digest } from "../../src/model/index.js";
import { genericPrivateDirectorySync } from "../../src/base/publication/index.js";
import { checkWriting } from "../../src/domain/writing/index.js";
import { runCase } from "../../src/domain/tests/index.js";
import { OwnedProcess, type OwnedProcessResult } from "../../src/base/process/index.js";

const path = 'docs/feature/sample/use-case/flow.md';
const packedRoot = mkdtempSync(join(tmpdir(), 'concord-steps-packed-'));
let entry: string;
before(() => { const install = join(packedRoot, 'install'); mkdirSync(install); writeFileSync(join(install, 'package.json'), JSON.stringify({ private: true })); prepareSourceConsumer(install, sourceConcord()); entry = packageBin(join(install, 'node_modules/concord-sdlc')); });
after(() => rmSync(packedRoot, { recursive: true, force: true }));
function document(body: string, kind: 'use-case' | 'feature' = 'use-case') {
  return renderDocument(kind === 'use-case' ? { format: 'concord.document/v1', kind, id: 'flow', title: 'Flow', feature: 'docs/feature/sample/README.md' } : { format: 'concord.document/v1', kind, id: 'sample', title: 'Sample' }, body);
}
function consumer(run: (repo: LocalRepository, root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'concord-steps-'));
  let repo: LocalRepository | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    repo = new LocalRepository(root, { initialize: true });
    initialize(repo, false, { sourceRoots: ['src'], testRoots: ['test'] });
    createDocument(repo, 'feature', { id: 'sample', title: 'Sample', pages: [] });
    createDocument(repo, 'use-case', { id: 'flow', title: 'Flow', feature: 'sample' });
    for (const dir of ['src', 'test']) mkdirSync(join(root, dir));
    run(repo, root);
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
}
function write(root: string, file: string, source: string) { mkdirSync(resolve(root, file, ".."), { recursive: true }); writeFileSync(join(root, file), source); }
function cli(root: string, args: readonly string[], status = 0) {
  const result = spawnSync(process.execPath, [entry, '--root', root, '--json', '--fresh', ...args], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, status, result.stdout + result.stderr);
  return JSON.parse(result.stdout || result.stderr) as unknown;
}

// @use-case docs/feature/local-sdlc/use-case/link-tests-to-steps.md#rename-step
// @name steps-process-death-and-recovery
test('steps C19 second CLI blocks interrupted work and recovers prepared and committed journals without overwriting unknown edits', () => Effect.runPromise(Effect.sync(() => {
  for (const phase of ['prepared', 'committed', 'unknown'] as const) consumer((repo, root) => {
    write(root, path, document('1. A {#old}\n'));
    write(root, 'test/flow.ts', `// @use-case ${path}#old\n`);
    const before = repo.read(path)!;
    repo.close();
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--import', resolve('test/support/step-interruption.ts'), entry, '--root', root, '--json', 'use-case', 'rename-step', path, 'old', 'new'], { encoding: 'utf8', timeout: 20000, env: { ...process.env, STEP_ROOT: root, STEP_INTERRUPT: phase === 'committed' ? 'committed' : 'prepared' } });
    assert.equal(child.signal, 'SIGKILL', child.stdout + child.stderr);
    const journal = join(genericPrivateDirectorySync(root), 'journal.json');
    assert.ok(existsSync(journal));
    const error = Schema.Struct({ error: Schema.String });
    assert.equal(Schema.decodeUnknownSync(error)(cli(root, ['use-case', 'steps', path], 1)).error, 'RecoveryRequired');
    assert.equal(Schema.decodeUnknownSync(error)(cli(root, ['use-case', 'format', path], 1)).error, 'RecoveryRequired');
    if (phase === 'unknown') {
      write(root, 'test/flow.ts', '// External edit\n');
      assert.equal(Schema.decodeUnknownSync(error)(cli(root, ['recover'], 1)).error, 'RecoveryConflict');
      assert.equal(readFileSync(join(root, 'test/flow.ts'), 'utf8'), '// External edit\n');
      assert.ok(existsSync(journal));
    } else {
      const result = Schema.decodeUnknownSync(Schema.Struct({ status: Schema.String }))(cli(root, ['recover']));
      assert.equal(result.status, phase === 'prepared' ? 'rolled-back' : 'committed');
      assert.equal(readFileSync(join(root, path), 'utf8'), phase === 'prepared' ? before : before.replace('{#old}', '{#new}'));
      assert.equal(existsSync(journal), false);
      cli(root, ['use-case', 'steps', path]);
    }
  });
})));
