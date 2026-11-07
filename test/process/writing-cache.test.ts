// 跨进程保证：服务与 IPC——独立CLI重复读取复用服务拥有的写作缓存，真实解析计数降为零且输出字节一致。
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { stopWorkspaceServer } from '../support/stop-workspace-server.ts';
import { initialize } from '../support/operations.ts';
import { installedConcordCli } from '../support/support.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect } from 'effect';
import { LocalRepository } from "../support/repository.ts";

import { checkWriting } from "../../src/domain/writing/index.ts";
import { openHawdb } from "../../src/base/cache/index.ts";

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);

const policy = '# Rules\n\n句子不超过 5 个字符。\n';
function fixture(run: (root: string, scan: (cache?: boolean) => ReturnType<typeof checkWriting>) => void) {
  const root = mkdtempSync(join(tmpdir(), 'concord-writing-cache-'));
  execFileSync('git', ['init', '-q', root]);
  const initial = new LocalRepository(root, { initialize: true });
  try { initialize(initial, false, { testRoots: [] }); } finally { initial.close(); }
  writeFileSync(join(root, 'docs/writing.md'), policy);
  writeFileSync(join(root, 'docs/corpus.md'), 'One two three.\n');
  openHawdb(join(root, '.git/concord/cache.hawdb'), { readOnly: false, create: true }, nativeRuntime).close();
  const scan = (cache = true) => {
    const repo = new LocalRepository(root, { access: 'read' });
    try { return checkWriting(repo, undefined, cache); } finally { repo.close(); }
  };
  try { run(root, scan); } finally { stopWorkspaceServer(root); rmSync(root, { recursive: true, force: true }); }
}

// @use-case docs/feature/documentation-quality/use-case/inspect-writing.md
test('public CLI uses current prose without cache and reuses service-owned writing findings', () => Effect.runPromise(Effect.sync(() => fixture((root, scan) => {
  const loaded = join(root, 'loaded.json'), counts = join(root, 'parse-counts.jsonl');
  const modules = (dryRun = false) => {
    let output = ''; writeFileSync(counts, '');
    try {
      output = execFileSync(process.execPath, ['--import', fileURLToPath(new URL('../support/cli-load-probe.ts', import.meta.url)), '--import', fileURLToPath(new URL('../support/parse-count-probe.ts', import.meta.url)), installedConcordCli(), '--root', root, ...(dryRun ? ['--dry-run'] : []), 'docs', 'check', '--json'], {
        encoding: 'utf8', env: { ...process.env, CONCORD_TEST_LOADED_MODULES: loaded, CONCORD_TEST_PARSE_COUNTS: counts }, stdio: 'pipe',
      });
    } catch (cause) {
      const result = cause as { status: number; stdout: string; stderr: string };
      assert.equal(result.status, 1, 'findings produce the normal nonzero result');
      output = result.stdout || result.stderr;
    }
    assert.equal(JSON.parse(output).operation, 'docs-check', output);
    return { output, parses: readFileSync(counts, 'utf8').trim().split('\n').filter(Boolean).filter(value => JSON.parse(value) === 'One two three.\n') };
  };
  const cold = modules(true);
  modules();
  assert.ok(cold.parses.length > 0, 'cold positive control must observe real prose parsing');
  const warm = modules();
  assert.equal(warm.parses.length, 0, 'validated cache hit must perform no Markdown parsing');
  assert.equal(warm.output, cold.output, 'cache reuse preserves public output bytes');
  stopWorkspaceServer(root);
  assert.deepEqual(scan(false), scan(), 'cache-disabled overlay analysis has identical findings');
}))));
