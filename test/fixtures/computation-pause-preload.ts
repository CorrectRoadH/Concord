import { existsSync, writeFileSync } from 'node:fs';

// Pause the real foreground worker only after the test arms its input boundary.
const boundary = process.env.CONCORD_TEST_COMPUTATION_PAUSED;
if (boundary && process.argv[1]?.endsWith('/entry/server/compute-worker.ts') && process.argv.at(-1) === 'foreground') {
  process.stdin.on('data', () => {
    if (!existsSync(`${boundary}.armed`)) return;
    writeFileSync(boundary, String(process.pid));
    process.kill(process.pid, 'SIGSTOP');
  });
}
