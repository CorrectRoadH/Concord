// Cross-process guarantee: a real workspace service owns the database while the
// command-owned native runner completes through the public CLI.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { command, fixture, record, stop } from '../support/workspace-server-fixture.ts';

// @feature docs/feature/local-data-engine/architecture.md#句柄与打开模式
test('native test execution completes while the workspace service owns the persistent cache', { timeout: 60_000 }, async () => {
  const root = fixture();
  const source = fileURLToPath(new URL('../..', import.meta.url));
  try {
    mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'test/sample.ts'), '// @feature docs/feature/reader/README.md\n// @name cache-busy-native\n');
    writeFileSync(join(root, 'package.json'), '{"type":"module"}\n');
    symlinkSync(join(source, 'node_modules'), join(root, 'node_modules'), 'dir');
    writeFileSync(join(root, 'adapter.ts'), readFileSync(join(source, 'test/fixtures/process-adapter.ts'), 'utf8'));
    writeFileSync(join(root, 'mode.txt'), 'green');
    writeFileSync(join(root, 'concord.config.ts'), `export default ${JSON.stringify({ testRoots: ['test'], testAdapters: [{ id: 'fixture', include: ['test'], argv: [process.execPath, 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], lockFiles: [], frameworkVersion: 'fixture/v1', envNames: ['PATH'] }] })};\n`);
    const started = await command(root, ['server', 'start']);
    assert.equal(started.status, 0, started.stderr);
    const pid = record(root).pid;
    const listed = await command(root, ['test', 'list']);
    assert.equal(listed.status, 0, listed.stderr);
    const selected = JSON.parse(listed.stdout).cases.find((item: { name: string }) => item.name === 'cache-busy-native') as { id: string } | undefined;
    assert.ok(selected);
    const result = await command(root, ['test', 'run', selected.id, '--require-native']);
    assert.equal(result.status, 0, `the real adapter must execute despite a busy parse cache: ${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.equal(report.scope, 'native');
    assert.equal(report.commandOutcome, 'green');
    assert.ok(report.statuses.length > 0);
    assert.equal(report.cleanupOk, true);
    assert.equal(record(root).pid, pid, 'the existing service keeps its ownership');
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});
