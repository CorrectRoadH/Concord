import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';

// Inherited NODE_OPTIONS loads this at the real worker boundary. Pause before
// executing its unchanged entry; the test observes the OS stopped state.
Effect.runSync(Effect.sync(() => {
  const gate = join(process.cwd(), '.git/concord/editor-job-gate');
  if (!/editor-worker\.[jt]s$/u.test(process.argv[1] ?? '') || !existsSync(gate)) return;
  rmSync(gate);
  writeFileSync(`${gate}.paused`, String(process.pid));
  process.kill(process.pid, 'SIGSTOP');
}));
