import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { Effect, Schema } from 'effect';

// Inject a process death at the real atomic publication boundary, before loading the CLI.
Effect.runSync(Effect.sync(() => {
  const { STEP_INTERRUPT, STEP_ROOT } = Schema.decodeUnknownSync(Schema.Struct({ STEP_INTERRUPT: Schema.Literals(['prepared', 'committed']), STEP_ROOT: Schema.String }))(process.env, { onExcessProperty: 'ignore' });
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    const target = String(to);
    const committed = target.endsWith('/concord/journal.json') && /"phase":"committed"/u.test(fs.readFileSync(from, 'utf8'));
    rename(from, to);
    if (STEP_INTERRUPT === 'prepared' && target.startsWith(`${STEP_ROOT}/docs/`) || STEP_INTERRUPT === 'committed' && committed) process.kill(process.pid, 'SIGKILL');
  };
  syncBuiltinESMExports();
}));
