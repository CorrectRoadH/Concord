// @concord-file
// @concord-implements docs/engineering/testing/README.md#成本与稳定
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, Schema } from 'effect';
import { classifyConcordProcess, processEventEnvironment, processEventsHealthy, observeProcessEvents, recordProcessEvent, recordProcessSpawn } from '../../src/base/process/index.ts';

let installed = false;

/** Installed by --import before tests take named references to child_process exports. */
export function installProcessEvents(context?: { readonly directory: string; readonly run: string }): void {
  if (context !== undefined) {
    process.env.CONCORD_TEST_EVENT_DIRECTORY = context.directory;
    process.env.CONCORD_TEST_RUN_ID = context.run;
    // Each isolated Node file process supplies its own real entry, never its parent's file ID.
    if (/\.(?:test|e2e)\.ts$/u.test(process.argv[1] ?? '') || process.env.CONCORD_TEST_FILE_ID === undefined) process.env.CONCORD_TEST_FILE_ID = resolve(process.argv[1] ?? 'unknown');
  }
  if (!process.env.CONCORD_TEST_EVENT_DIRECTORY || !process.env.CONCORD_TEST_RUN_ID || !process.env.CONCORD_TEST_FILE_ID) return;
  if (installed) return;
  installed = true;
  const releaseObserver = observeProcessEvents();
  const ownerEnvironment = Object.freeze({ ...process.env });
  let depth = 0;
  const StartedFailure = Schema.Struct({ pid: Schema.Int.check(Schema.isGreaterThan(0)) });
  // Node 26 diagnostics_channel observes async spawn only; sync exports need explicit hooks.
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork', 'exec', 'execSync'] as const) {
    const original = childProcess[name];
    const wrapped = function(this: unknown, ...input: unknown[]) {
      if (depth > 0) return Reflect.apply(original, this, input);
      depth++;
      try {
        const executable = typeof input[0] === 'string' ? input[0] : input[0] instanceof URL ? fileURLToPath(input[0]) : '';
        const args = Array.isArray(input[1]) ? input[1] as string[] : [];
        const command = name === 'fork' ? [process.execPath, executable, ...args] : [executable, ...args];
        const index = name === 'exec' || name === 'execSync' ? 1 : Array.isArray(input[1]) || input[1] == null ? 2 : 1;
        const options = input[index] !== null && typeof input[index] === 'object' ? input[index] as { env?: NodeJS.ProcessEnv } : {};
        const inherited = options.env?.CONCORD_TEST_PROCESS_EVENT_ID;
        // Product adapters already own these events and have prepared the child's association.
        const prepared = inherited !== undefined && inherited !== process.env.CONCORD_TEST_PROCESS_EVENT_ID;
        const env = prepared ? options.env! : processEventEnvironment(command, options.env ?? process.env);
        if (!prepared && (classifyConcordProcess(command) === undefined && /^(?:node(?:\.exe)?|bun|pnpm|npm|npx|yarn|corepack|sh|bash|zsh|dash|env|cmd(?:\.exe)?|powershell(?:\.exe)?)$/u.test(basename(executable)) || name === 'exec' || name === 'execSync')) recordProcessEvent({ kind: 'unknown' }, env);
        if (typeof input[index] === 'function') input.splice(index, 0, { ...options, env });
        else input[index] = { ...options, env };
        let result: { pid?: number } | Buffer | string;
        try { result = Reflect.apply(original, this, input) as typeof result; } catch (cause) {
          const started = Schema.decodeUnknownExit(StartedFailure, { onExcessProperty: 'ignore' })(cause);
          if (!prepared && name === 'execFileSync' && started._tag === 'Success') recordProcessSpawn(command, env, started.value.pid);
          throw cause;
        }
        if (!prepared && typeof result === 'object' && result !== null && 'pid' in result) recordProcessSpawn(command, env, result.pid !== undefined && result.pid > 0 ? result.pid : undefined);
        // execFileSync returns bytes rather than its child's pid. Its successful return proves a start.
        else if (!prepared && name === 'execFileSync' && classifyConcordProcess(command) !== undefined) recordProcessEvent({ kind: 'spawn', role: classifyConcordProcess(command), id: `${env.CONCORD_TEST_PROCESS_EVENT_ID}:spawn` }, env);
        return result;
      } finally { depth--; }
    };
    Object.defineProperty(childProcess, name, { value: wrapped, configurable: true, writable: true });
  }
  syncBuiltinESMExports();
  const root = process.env.CONCORD_TEST_EVENT_SCOPE === 'browser-worker' || /\.(?:test|e2e)\.ts$/u.test(process.argv[1] ?? '');
  recordProcessEvent({ kind: root ? 'coverage-start' : 'process-start' }, ownerEnvironment);
  process.once('exit', () => { try { Effect.runSync(Effect.sync(() => recordProcessEvent({ kind: root ? 'coverage-end' : 'process-end', healthy: processEventsHealthy() }, ownerEnvironment))); } finally { releaseObserver(); } });
}
