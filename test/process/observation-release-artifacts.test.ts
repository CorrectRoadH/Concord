// 跨进程保证：强杀一个真实的收集占用者后，人工解除回收该次收集的产物。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Schema } from 'effect';
import { observeOwnedProcessGroup } from '../../src/base/process/index.ts';
import { fixture } from '../support/publication-ownership-fixture.ts';
import { sourceCli, sourceCliCommand } from '../support/source-consumer.ts';
import { pollUntil, writeProjectConfig } from '../support/support.ts';
import { command } from '../support/workspace-server-fixture.ts';

const AdapterReady = Schema.fromJsonString(Schema.Struct({ pid: Schema.Int.check(Schema.isGreaterThan(0)), reportDirectory: Schema.String }));
const ObservationSlot = Schema.fromJsonString(Schema.Struct({ observationSlot: Schema.Struct({ status: Schema.String, pid: Schema.Int, token: Schema.String }) }));

// @use-case docs/feature/local-sdlc/use-case/recover-local-state.md#release-observation-slot
// @issue docs/issues/observation-release-artifacts.md
test('manual release reclaims the report directory of a killed collection', { skip: process.platform === 'win32', timeout: 30_000 }, async t => {
  const root = await fixture(t);
  const ready = join(root, '.git/adapter-ready.json');
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'test/sample.ts'), 'export {};\n');
  writeFileSync(join(root, 'adapter.ts'), `
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const request: { context: { reportDirectory: string } } = JSON.parse(readFileSync(0, 'utf8'));
const reportDirectory = request.context.reportDirectory;
writeFileSync(join(reportDirectory, 'partial.txt'), 'incomplete report');
const ready = ${JSON.stringify(ready)};
writeFileSync(ready + '.tmp', JSON.stringify({ pid: process.pid, reportDirectory }));
renameSync(ready + '.tmp', ready);
setInterval(() => {}, 60_000);
`);
  writeProjectConfig(root, { testRoots: ['test'], testAdapters: [{ id: 'fixture', include: ['test'], argv: [process.execPath, 'adapter.ts'], implementationFiles: ['adapter.ts'], inputRoots: [], lockFiles: [], envNames: [] }] });

  const [executable, ...prefix] = sourceCliCommand();
  const collector = spawn(executable, [...prefix, '--root', root, '--json', '--server=command', 'test', 'discover', 'test/sample.ts'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  collector.stderr.on('data', bytes => { stderr += String(bytes); });
  const closed = new Promise<NodeJS.Signals | null>((resolve, reject) => {
    collector.once('error', reject);
    collector.once('close', (_code, signal) => resolve(signal));
  });
  const adapterReady = () => Schema.decodeUnknownSync(AdapterReady)(readFileSync(ready, 'utf8'));
  const stopAdapter = async (pid: number) => {
    if (observeOwnedProcessGroup(pid) === 'alive') process.kill(-pid, 'SIGKILL');
    await pollUntil(async () => ['gone', 'zombie-only'].includes(observeOwnedProcessGroup(pid)) ? true : undefined, { description: 'adapter group has no living processes' });
  };
  try {
    const adapter = await Promise.race([
      pollUntil(async () => existsSync(ready) ? adapterReady() : undefined, { description: 'adapter writes its report', timeoutMs: 10_000 }),
      closed.then(() => { throw new Error(`Collection exited before its adapter was ready: ${stderr}`); }),
    ]);
    const artifacts = dirname(adapter.reportDirectory);
    const unrelated = join(dirname(artifacts), 'adapter-reports-unrelated');
    mkdirSync(unrelated);
    assert.equal(observeOwnedProcessGroup(adapter.pid), 'alive');
    assert.equal(collector.kill('SIGKILL'), true);
    assert.equal(await closed, 'SIGKILL');
    await stopAdapter(adapter.pid);
    assert.equal(readFileSync(join(adapter.reportDirectory, 'partial.txt'), 'utf8'), 'incomplete report');

    const blocked = await command(root, ['recover'], sourceCli());
    assert.equal(blocked.status, 1, blocked.stderr);
    const { observationSlot } = Schema.decodeUnknownSync(ObservationSlot)(blocked.stdout);
    assert.equal(observationSlot.status, 'blocked');
    assert.equal(observationSlot.pid, collector.pid);
    const release = await command(root, ['recover', '--release-observation-slot', observationSlot.token], sourceCli());
    assert.equal(release.status, 0, release.stderr);
    assert.equal(existsSync(artifacts), false, `release left behind ${artifacts}`);
    assert.equal(existsSync(unrelated), true);
  } finally {
    if (collector.exitCode === null && collector.signalCode === null) collector.kill('SIGKILL');
    await closed;
    if (existsSync(ready)) await stopAdapter(adapterReady().pid);
  }
});
