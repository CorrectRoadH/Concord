// 跨进程保证：进程终止与信号——官方编译器 supervisor 在 EOF 或超时后回收拒绝 TERM 的自有子进程。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { tmpdir } from '../support/temporary.ts';

// @feature docs/feature/local-sdlc/README.md
test('compiler supervisor reaps its stubborn native child after EOF and its independent deadline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-compiler-owner-'));
  try {
    const executable = join(root, 'native');
    // Only the external native boundary is simulated. The production supervisor owns actual pipes and signals.
    writeFileSync(executable, '#!/bin/sh\ntrap "" TERM\nprintf "%s\\n" "$$"\nwhile :; do read -r line || :; done\n');
    chmodSync(executable, 0o755);
    for (const mode of ['eof', 'deadline']) {
      const child = spawn(process.execPath, ['--no-env-file', '--config=/dev/null', resolve('test/fixtures/compiler-supervisor-worker.ts'), executable, mode === 'eof' ? '10000' : '250'], { stdio: ['pipe', 'pipe', 'pipe'], detached: true });
      const closed = once(child, 'close');
      let output = '';
      child.stdout.on('data', chunk => { output += String(chunk); });
      const timer = setTimeout(() => { if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL'); }, 15_000);
      try {
        await once(child.stdout, 'data');
        const pid = Number(output.trim());
        assert.ok(Number.isInteger(pid) && pid > 0);
        if (mode === 'eof') child.stdin.end();
        const [code, signal] = await closed;
        assert.equal(signal, null);
        assert.equal(code, mode === 'eof' ? 0 : 1);
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
      } finally {
        clearTimeout(timer);
        if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
          process.kill(-child.pid, 'SIGKILL');
          await closed;
        }
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
