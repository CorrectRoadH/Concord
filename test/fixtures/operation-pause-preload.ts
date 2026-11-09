import { writeFileSync } from 'node:fs';

// Pause only the real operation child once its request reaches stdin.
const boundary = process.env.CONCORD_TEST_OPERATION_PAUSED;
if (boundary && process.argv[1]?.endsWith('/entry/server/operation/main.ts')) {
  process.stdin.once('data', () => {
    writeFileSync(boundary, String(process.pid));
    process.kill(process.pid, 'SIGSTOP');
  });
}
