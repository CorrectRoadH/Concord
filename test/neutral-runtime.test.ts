import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { Effect } from 'effect';
import {
  GovernanceConfigurationError,
  governanceSuiteForFile,
  readGovernanceConfiguration,
} from '../dist/governance-config.js';
import { createDocument } from '../dist/documents.js';
import { initialize, LocalRepository } from '../dist/storage.js';
import { readViewTests } from '../dist/repository/view-tests.js';

const write = (root: string, path: string, source: string): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), source);
};

const configuration = (suites: readonly { readonly id: string; readonly root: string }[], extra: object = {}) => JSON.stringify({
  format: 'concord.repository/v2',
  suites,
  historyPath: 'records/case-history.ts',
  policy: 'concord.native-reliability/v1',
  ...extra,
});

const hasCode = (code: string) => (cause: unknown): boolean => cause instanceof GovernanceConfigurationError && cause.code === code;

// @use-case docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
test('governance v2 discovers non-Nx, non-e2e suites without requiring a host', () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-neutral-config-'));
  try {
    mkdirSync(join(root, 'acceptance/browser/spec'), { recursive: true });
    write(root, 'concord.repository.json', configuration([{ id: 'browser', root: 'acceptance/browser' }]));
    const snapshot = readGovernanceConfiguration(root);
    assert.equal(snapshot?.config.format, 'concord.repository/v2');
    assert.equal(snapshot?.config.host, undefined);
    assert.match(snapshot?.digest ?? '', /^sha256:[0-9a-f]{64}$/u);
    assert.deepEqual(governanceSuiteForFile(root, 'acceptance/browser/spec/checkout.test.ts'), { id: 'browser', root: 'acceptance/browser' });
    assert.throws(() => governanceSuiteForFile(root, '../outside.test.ts'), hasCode('GovernanceFilePathInvalid'));
    assert.throws(() => governanceSuiteForFile(root, 'unmanaged/example.test.ts'), hasCode('GovernanceSuiteNotFound'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
test('governance v2 rejects legacy, duplicate, nested and unsafe suite roots', () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-neutral-paths-'));
  try {
    for (const path of ['a', 'a-b', 'a/b']) mkdirSync(join(root, path), { recursive: true });
    write(root, 'concord.repository.json', JSON.stringify({ format: 'concord.repository/v1', host: 'host.ts' }));
    assert.throws(() => readGovernanceConfiguration(root), hasCode('GovernanceConfigurationMigrationRequired'));

    write(root, 'concord.repository.json', configuration([{ id: 'one', root: 'a' }, { id: 'one', root: 'a-b' }]));
    assert.throws(() => readGovernanceConfiguration(root), hasCode('GovernanceSuiteDuplicate'));

    write(root, 'concord.repository.json', configuration([{ id: 'one', root: 'a' }, { id: 'two', root: 'a' }]));
    assert.throws(() => readGovernanceConfiguration(root), hasCode('GovernanceSuiteDuplicate'));

    write(root, 'concord.repository.json', configuration([
      { id: 'parent', root: 'a' },
      { id: 'intervening', root: 'a-b' },
      { id: 'child', root: 'a/b' },
    ]));
    assert.throws(() => readGovernanceConfiguration(root), hasCode('GovernanceSuiteOverlap'));

    write(root, 'concord.repository.json', JSON.stringify({
      format: 'concord.repository/v2',
      suites: [{ id: 'one', root: 'a' }],
      historyPath: 'a/history.ts',
      policy: 'concord.native-reliability/v1',
    }));
    assert.throws(() => readGovernanceConfiguration(root), hasCode('GovernanceHistoryOverlap'));

    mkdirSync(join(root, 'records/case-history.ts'), { recursive: true });
    write(root, 'concord.repository.json', configuration([{ id: 'one', root: 'a' }]));
    assert.throws(() => readGovernanceConfiguration(root), hasCode('GovernanceHistoryInvalid'));
    rmSync(join(root, 'records'), { recursive: true, force: true });

    write(root, 'concord.repository.json', configuration([{ id: 'escape', root: '../outside' }]));
    assert.throws(() => readGovernanceConfiguration(root), hasCode('GovernanceConfigurationInvalid'));

    rmSync(join(root, 'concord.repository.json'));
    symlinkSync('missing-config.json', join(root, 'concord.repository.json'));
    assert.throws(() => readGovernanceConfiguration(root), hasCode('GovernanceConfigurationUnsafe'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
test('governance path checks reject dangling symlink components', () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-neutral-symlink-'));
  try {
    symlinkSync('missing-target', join(root, 'broken'));
    write(root, 'concord.repository.json', configuration([{ id: 'broken', root: 'broken/suite' }]));
    assert.throws(() => readGovernanceConfiguration(root), hasCode('GovernancePathSymlink'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
test('host module has no eager consumer load and reports a missing capability by name', async () => {
  const lazy = await import('../dist/repository/host.js');
  assert.equal(typeof lazy.readManagedRedEvidence, 'function');

  const root = mkdtempSync(join(tmpdir(), 'concord-neutral-host-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    mkdirSync(join(root, 'acceptance/native'), { recursive: true });
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(resolve('.'), join(root, 'node_modules/concord-sdlc'), 'dir');
    write(root, 'package.json', JSON.stringify({ private: true, type: 'module' }));
    write(root, 'host.mjs', `export default ${JSON.stringify({
      format: 'concord.repository-host/v2',
      caseIdentity: 'concord.case-contracts/v1',
      repositoryRoot: root,
    })};\n`);
    write(root, 'concord.repository.json', configuration(
      [{ id: 'native', root: 'acceptance/native' }],
      { host: 'host.mjs' },
    ));
    const effectEntry = pathToFileURL(resolve('node_modules/effect/dist/index.js')).href;
    write(root, 'invoke.mjs', `import { Effect } from ${JSON.stringify(effectEntry)};
import { readManagedRedEvidence } from 'concord-sdlc/repository/host';
try { await Effect.runPromise(readManagedRedEvidence(process.cwd(), 'missing')); }
catch (cause) { process.stdout.write(String(cause.code ?? cause._tag ?? cause.name)); }
`);
    const output = execFileSync(process.execPath, ['invoke.mjs'], { cwd: root, encoding: 'utf8' });
    assert.equal(output, 'RepositoryHostCapabilityMissing');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
test('static suite projection scans configured roots without importing the host', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-neutral-static-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const repository = new LocalRepository(root, { initialize: true });
    try {
      initialize(repository, false, { testRoots: [] });
      createDocument(repository, 'feature', { id: 'neutral', title: 'Neutral runtime' });
      createDocument(repository, 'use-case', { id: 'scan', title: 'Scan suite', feature: 'neutral' });
    } finally { repository.close(); }
    mkdirSync(join(root, 'acceptance/unit'), { recursive: true });
    write(root, 'host.mjs', 'throw new Error("HOST MUST NOT LOAD");\n');
    write(root, 'concord.repository.json', configuration(
      [{ id: 'unit', root: 'acceptance/unit' }],
      { host: 'host.mjs' },
    ));
    write(root, 'acceptance/unit/example.test.ts', `import { test } from 'node:test';
// @use-case docs/feature/neutral/use-case/scan.md
test('neutral suite case', () => {});
`);
    const projected = await Effect.runPromise(readViewTests(root));
    assert.equal(projected.length, 1);
    assert.equal(projected[0]?.file, 'acceptance/unit/example.test.ts');
    assert.deepEqual(projected[0]?.features, ['docs/feature/neutral/README.md']);
    assert.equal('executor' in projected[0]!, false);
    assert.equal('lanes' in projected[0]!, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
