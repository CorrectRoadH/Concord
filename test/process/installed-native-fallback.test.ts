// 跨进程保证：原生模块与句柄——私有安装真实native工件损坏或丢失时降级读取，写入与服务启动拒绝且不残留运行记录。
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { hawdbLibraryName, hawdbTarget } from '../../src/base/installation/index.ts';
import { installationResources } from '../support/source-resources.ts';
import { privateSourceInstallation } from '../support/private-source.ts';
import { sourceCliCommand } from '../support/source-consumer.ts';
import { tmpdir } from '../support/temporary.ts';
import { Schema } from 'effect';

// @feature docs/feature/local-data-engine/architecture.md#cli-查询
test('broken source native artifacts keep current queries local and reject server startup', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-native-fallback-'));
  try {
    const installed = join(scratch, 'source');
    const cli = privateSourceInstallation(installed), root = join(scratch, 'consumer');
    mkdirSync(root); execFileSync('git', ['init', '-q', root]);
    const [command, ...prefix] = sourceCliCommand(cli);
    const invoke = (...args: string[]) => spawnSync(command, [...prefix, '--root', root, '--json', ...args], { encoding: 'utf8', timeout: 20_000, env: { ...process.env, NODE_OPTIONS: '' } });
    const initialized = invoke('init', '--docs-only');
    assert.equal(initialized.status, 0, initialized.stdout + initialized.stderr);
    const binary = join(installationResources(installed).native, hawdbTarget(), hawdbLibraryName(hawdbTarget()));
    const bytes = readFileSync(binary);
    for (const damage of ['digest', 'missing']) {
      if (damage === 'digest') { writeFileSync(`${binary}.next`, Buffer.concat([bytes, Buffer.from('invalid digest')])); renameSync(`${binary}.next`, binary); }
      else rmSync(binary);
      const status = invoke('cache', 'status');
      assert.equal(status.status, 0, status.stdout + status.stderr);
      const diagnostic = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ status: Schema.Literal('unavailable'), detail: Schema.String })))(status.stdout);
      for (const mode of ['command', 'shared']) {
        const scan = invoke(`--server=${mode}`, 'test', 'list');
        assert.equal(scan.status, 0, scan.stdout + scan.stderr);
        const value = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ cache: Schema.Struct({ status: Schema.Literal('unavailable'), detail: Schema.String }), cases: Schema.Array(Schema.Unknown) })))(scan.stdout);
        assert.equal(value.cache.detail, diagnostic.detail);
      }
      for (const args of [['trace', 'gaps'], ['server', 'start'], ['server', 'run']]) {
        const result = invoke(...args);
        assert.equal(result.status, 1, result.stdout + result.stderr);
        const error = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ error: Schema.Literal('HawdbUnavailable') })))(result.stderr);
        assert.equal(error.error, 'HawdbUnavailable');
      }
      assert.equal(existsSync(join(root, '.git/concord/server/current.json')), false, 'fallback must not launch a service');
      if (damage === 'digest') { writeFileSync(`${binary}.next`, bytes); renameSync(`${binary}.next`, binary); }
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
