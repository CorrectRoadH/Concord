// @concord-file
// @concord-implements docs/engineering/testing/README.md#成本与稳定
import { appendFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { channel } from 'node:diagnostics_channel';
import { Effect, Layer, Schema } from 'effect';

export const ProcessRole = Schema.Literals(['cli', 'worker', 'service', 'compute', 'operation']);
export type ProcessRole = typeof ProcessRole.Type;
export const ProcessEvent = Schema.Struct({
  id: Schema.String, run: Schema.String, file: Schema.String,
  scope: Schema.optional(Schema.Literals(['test-file', 'browser-worker'])), workerID: Schema.optional(Schema.String),
  pid: Schema.Int, ppid: Schema.Int, childPid: Schema.optional(Schema.Int),
  kind: Schema.Literals(['attempt', 'spawn', 'service-ready', 'service-reuse', 'coverage-start', 'coverage-end', 'process-start', 'process-end', 'unknown']),
  role: Schema.optional(ProcessRole), instance: Schema.optional(Schema.String),
  healthy: Schema.optional(Schema.Boolean),
});
export type ProcessEvent = typeof ProcessEvent.Type;
let healthy = true;
let writerId: string | undefined;
let writtenBytes = 0;
let capped = false;
export const PROCESS_EVENT_FILE_LIMIT = 8 * 1024 * 1024;
export const processEventsHealthy = () => healthy;

/** No argv or environment values are persisted. A failed diagnostic never changes a command result. */
export function recordProcessEvent(event: Pick<ProcessEvent, 'kind'> & Partial<Pick<ProcessEvent, 'id' | 'role' | 'childPid' | 'instance' | 'healthy'>>, env: Readonly<NodeJS.ProcessEnv> = {}): void {
  const directory = env.CONCORD_TEST_EVENT_DIRECTORY, run = env.CONCORD_TEST_RUN_ID, file = env.CONCORD_TEST_FILE_ID;
  if (!directory || !run || !file) return;
  Effect.runSync(Effect.try({ try: () => {
    const value = Schema.decodeUnknownSync(ProcessEvent, { onExcessProperty: 'error' })({ ...event, id: event.id ?? randomUUID(), run, file, scope: env.CONCORD_TEST_EVENT_SCOPE ?? 'test-file', ...(env.CONCORD_TEST_WORKER_ID === undefined ? {} : { workerID: env.CONCORD_TEST_WORKER_ID }), pid: process.pid, ppid: process.ppid });
    if (capped) { healthy = false; return; }
    let line = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(line) > 16 * 1024 || writtenBytes + Buffer.byteLength(line) > PROCESS_EVENT_FILE_LIMIT - 16 * 1024) {
      healthy = false; capped = true;
      line = `${JSON.stringify({ id: randomUUID(), run, file, pid: process.pid, ppid: process.ppid, scope: value.scope, ...(value.workerID === undefined ? {} : { workerID: value.workerID }), kind: 'unknown', healthy: false })}\n`;
    }
    writerId ??= randomUUID();
    mkdirSync(directory, { recursive: true });
    appendFileSync(join(directory, `${process.pid}-${writerId}.jsonl`), line);
    writtenBytes += Buffer.byteLength(line);
  }, catch: () => undefined }).pipe(Effect.catch(() => Effect.sync(() => { healthy = false; }))));
}

/** Match installed and source entry paths, independently of the executable's spelling. */
export function classifyConcordProcess(command: readonly string[]): ProcessRole | undefined {
  const paths = command.map(value => value.replaceAll('\\', '/'));
  if (paths.some(value => /\/entry\/server\/operation\/main\.(?:ts|js)$/u.test(value))) return 'operation';
  if (paths.some(value => /\/entry\/server\/compute-worker\.(?:ts|js)$/u.test(value))) return 'compute';
  if (paths.some(value => /\/entry\/cli\/entry\.(?:ts|js)$/u.test(value) || /(?:^|\/)bin\/concord$/u.test(value)) || basename(command[0] ?? '') === 'concord') {
    return paths.includes('server') && paths.includes('run') ? 'service' : 'cli';
  }
  if (paths.some(value => /\/entry\/(?:server\/[^/]+|web-build\/main)\.(?:ts|js)$/u.test(value))) return 'worker';
  return undefined;
}

export function processEventEnvironment(command: readonly string[], input: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  if (!input.CONCORD_TEST_EVENT_DIRECTORY || !input.CONCORD_TEST_RUN_ID || !input.CONCORD_TEST_FILE_ID) return input;
  const env = { ...input };
  const role = classifyConcordProcess(command);
  if (role === undefined) return env;
  env.CONCORD_TEST_PROCESS_EVENT_ID = randomUUID();
  recordProcessEvent({ kind: 'attempt', role, id: `${env.CONCORD_TEST_PROCESS_EVENT_ID}:attempt` }, env);
  return env;
}
export function recordProcessSpawn(command: readonly string[], env: NodeJS.ProcessEnv, pid: number | undefined): void {
  const role = classifyConcordProcess(command), id = env.CONCORD_TEST_PROCESS_EVENT_ID;
  if (role !== undefined && pid !== undefined && id !== undefined) recordProcessEvent({ kind: 'spawn', role, childPid: pid, id: `${id}:spawn` }, env);
}

let connectionObservers = 0;
let stopObservingConnections: (() => void) | undefined;
/** Explicit owners share one subscription, while each message owns its diagnostic environment. */
export function observeProcessEvents(): () => void {
  if (stopObservingConnections === undefined) {
    const events = channel('concord.test.process-event');
    const ConnectionEnvironment = Schema.Struct({ environment: Schema.Record(Schema.String, Schema.UndefinedOr(Schema.String)) });
    const ConnectionEvent = Schema.Struct({ ...ConnectionEnvironment.fields, kind: Schema.Literal('service-reuse') });
    const observer = (value: unknown) => {
      const routed = Schema.decodeUnknownExit(ConnectionEnvironment, { onExcessProperty: 'ignore' })(value);
      if (routed._tag === 'Failure') return;
      const decoded = Schema.decodeUnknownExit(ConnectionEvent, { onExcessProperty: 'error' })(value);
      if (decoded._tag === 'Success') recordProcessEvent({ kind: decoded.value.kind, role: 'service' }, routed.value.environment);
      else recordProcessEvent({ kind: 'unknown' }, routed.value.environment);
    };
    events.subscribe(observer);
    stopObservingConnections = () => { events.unsubscribe(observer); };
  }
  connectionObservers++;
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (--connectionObservers === 0) {
      stopObservingConnections?.();
      stopObservingConnections = undefined;
    }
  };
}

/** A composition root owns the shared diagnostics subscription for its Scope. */
export const ProcessEventsLive = Layer.effectDiscard(Effect.acquireRelease(Effect.sync(observeProcessEvents), release => Effect.sync(release)));
