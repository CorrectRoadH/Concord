// 跨进程保证：外部程序——Bash 发布步骤通过 gh 子进程轮询本次派发的运行，只在首轮失败时请求重跑该运行的失败作业。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import { parseDocument } from 'yaml';

const fakeGh = String.raw`set -eu
case "$1 $2" in
  'workflow run')
    printf '%s\n' dispatch >> "$CALLS"
    ;;
  'api --method')
    [[ "$3" = POST && "$4" = repos/example/concord/actions/workflows/release.yml/dispatches ]]
    [[ "$*" = *'ref=master'* && "$*" = *'inputs[tag]=v0.15.0'* && "$*" = *'return_run_details=true'* ]]
    printf '%s\n' dispatch >> "$CALLS"
    printf '%s\n' 421
    ;;
  'api repos/example/concord/actions/runs/421')
    if [[ ! -f "$FIRST_OBSERVATION" ]]; then
      : > "$FIRST_OBSERVATION"
      printf '%s\n' observe-pending >> "$CALLS"
      printf '%s\n' '1 in_progress'
    else
      printf '%s\n' observe-completed >> "$CALLS"
      printf '%s\n' "$RUN_RESULT"
    fi
    ;;
  'run rerun')
    [[ "$3" = 421 && "$4" = --failed ]]
    printf '%s\n' retry-421 >> "$CALLS"
    ;;
  *) exit 97 ;;
esac
`;

function runTaggedDispatcher(runResult: string): string[] {
  const source = readFileSync(new URL('../../.github/workflows/release-tag.yml', import.meta.url), 'utf8');
  const script = parseDocument(source).getIn(['jobs', 'dispatch', 'steps', 0, 'run']);
  assert.ok(typeof script === 'string', 'Expected the release dispatch shell step');
  const bash = Bun.which('bash');
  assert.ok(bash, 'GitHub Actions runs the release dispatch step with Bash');
  const directory = mkdtempSync(join(tmpdir(), 'concord-tagged-release-'));
  const calls = join(directory, 'calls');
  try {
    writeFileSync(join(directory, 'gh'), `#!${bash}\n${fakeGh}`, { mode: 0o700 });
    writeFileSync(join(directory, 'sleep'), `#!${bash}\nexit 0\n`, { mode: 0o700 });
    const result = spawnSync(bash, ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        PATH: `${directory}:${process.env.PATH ?? ''}`,
        GH_REPO: 'example/concord',
        GH_TOKEN: 'local-test-token',
        RELEASE_BRANCH: 'master',
        RELEASE_TAG: 'v0.15.0',
        CALLS: calls,
        FIRST_OBSERVATION: join(directory, 'first-observation'),
        RUN_RESULT: runResult,
      },
      timeout: 5_000,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message || 'Release dispatch failed');
    return readFileSync(calls, 'utf8').trim().split('\n');
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

// @spec docs/feature/cross-platform-release/architecture.md#复用
test('tag dispatch retries the failed jobs of its own first attempt without a completion event', () => {
  assert.deepEqual(runTaggedDispatcher('1 completed failure'), ['dispatch', 'observe-pending', 'observe-completed', 'retry-421']);
});

// @spec docs/feature/cross-platform-release/architecture.md#复用
test('tag dispatch leaves successful, canceled and already retried runs alone', () => {
  for (const runResult of ['1 completed success', '1 completed cancelled', '2 completed failure']) {
    assert.ok(!runTaggedDispatcher(runResult).includes('retry-421'), runResult);
  }
});
