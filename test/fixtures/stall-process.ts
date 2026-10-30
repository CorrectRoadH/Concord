import { Effect } from 'effect';
// Pause the real worker at process startup, so its execution deadline is independent of scan speed.
Effect.runSync(Effect.sync(() => process.kill(process.pid, 'SIGSTOP')));
