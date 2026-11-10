import { existsSync, renameSync, writeFileSync } from 'node:fs';

// Pause the real foreground worker only after the test arms its input boundary.
const boundary = process.env.CONCORD_TEST_COMPUTATION_PAUSED;
if (boundary && process.argv[1]?.endsWith('/entry/server/compute-worker.ts') && process.argv.at(-1) === 'foreground') {
  const pause = () => {
    if (!existsSync(`${boundary}.armed`)) return;
    writeFileSync(`${boundary}.tmp`, String(process.pid));
    renameSync(`${boundary}.tmp`, boundary);
    process.kill(process.pid, 'SIGSTOP');
  };
  // Observe availability without consuming bytes or entering flowing mode:
  // a data listener during preload can discard the RPC reader's initial frame.
  process.stdin.on('readable', pause);
}
