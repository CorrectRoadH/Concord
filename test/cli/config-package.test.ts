import { initialize } from '../support/operations.ts';
import { runCli } from '../support/cli.ts';
import { stopCliWorkspace } from '../support/cli-complex-fixture.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { parseTypeScriptConfig, renderTypeScriptConfig } from "../../src/base/workspace/index.ts";
import { digest } from "../../src/model/index.ts";
import { LocalRepository } from "../support/repository.ts";


// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('source config initialization supplies the shipped writing policy', () => Effect.runPromise(Effect.promise(async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-config-package-'));
  const consumer = join(scratch, 'initialized');
  try {
    execFileSync('git', ['init', '-q', consumer]);
    const initialized = await runCli({ argv: ['--root', consumer, 'init', '--docs-only'], cwd: process.cwd(), env: process.env, signal: AbortSignal.timeout(30_000) });
    assert.equal(initialized.exitCode, 0, initialized.stdout + initialized.stderr);
    const result = await runCli({ argv: ['--root', consumer, 'writing', 'show', '--json'], cwd: process.cwd(), env: process.env, signal: AbortSignal.timeout(30_000) });
    assert.equal(result.exitCode, 0, result.stdout + result.stderr);
    const preset = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ state: Schema.String, policy: Schema.Struct({ sentenceLength: Schema.Number, paragraphLength: Schema.Number, bannedTerms: Schema.Array(Schema.Struct({ term: Schema.String })) }) })), { onExcessProperty: 'ignore' })(result.stdout);
    assert.equal(preset.state, 'valid');
    assert.equal(preset.policy.sentenceLength, 140);
    assert.equal(preset.policy.paragraphLength, 320);
    assert.ok(preset.policy.bannedTerms.some((ban: { term: string }) => ban.term === '兜底'));
  } finally {
    await stopCliWorkspace(consumer);
    rmSync(scratch, { recursive: true, force: true });
  }
})));

// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('prepared config recovery restores the frozen source bytes', () => Effect.runPromise(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(), 'concord-config-recovery-'));
  let repo: LocalRepository | undefined;
  try {
    execFileSync('git', ['init', '-q', root]);
    repo = new LocalRepository(root, { initialize: true }); initialize(repo, false, { testRoots: [] }); repo.close(); repo = undefined;
    const path = 'concord.config.ts', before = readFileSync(join(root, path), 'utf8');
    const config = parseTypeScriptConfig(before);
    const after = `// normalized later\n${renderTypeScriptConfig({ ...config, testRoots: [] })}`;
    const privateDir = join(root, '.git', 'concord');
    const journal = { format: 'concord.journal', root, privateDir, operation: 'set-config', phase: 'prepared', directories: [], scope: { kind: 'documents', configPath: path, configSource: before, configDigest: digest(before) }, changes: [{ path, before, after, beforeDigest: digest(before), afterDigest: digest(after), mode: 0o644 }] };
    writeFileSync(join(root, path), after);
    writeFileSync(join(privateDir, 'journal.json'), `${JSON.stringify(journal)}\n`);
    repo = new LocalRepository(root, { recover: true });
    assert.equal(repo.recover().status, 'rolled-back');
    assert.equal(readFileSync(join(root, path), 'utf8'), before);
  } finally { repo?.close(); rmSync(root, { recursive: true, force: true }); }
})));
