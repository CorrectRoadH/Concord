// @concord-file
// @concord-implements docs/engineering/testing/README.md#成本与稳定
import { Effect, FileSystem, Schema } from 'effect';
import { join, resolve } from 'node:path';
import { PROCESS_EVENT_FILE_LIMIT, ProcessEvent } from '../src/base/process/index.ts';
import { classifyTestLayer, testLayers } from './test-layers.ts';

const Run = Schema.Struct({ run: Schema.String, directory: Schema.String });
const roles = ['cli', 'worker', 'service', 'compute', 'operation'] as const;
export function summarizeProcessEvents(files: readonly string[], events: readonly ProcessEvent[], run: string | undefined, invalid = false) {
  const unique = new Map<string, ProcessEvent>();
  let conflicting = false;
  for (const event of events) {
    if (event.run !== run) continue;
    const previous = unique.get(event.id);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(event)) conflicting = true;
    else unique.set(event.id, event);
  }
  const selected = [...new Set(files.map(file => resolve(file)))];
  const summarize = (file: string, observed: readonly ProcessEvent[]) => {
    const roots = observed.filter(event => event.kind === 'coverage-start');
    const starts = observed.filter(event => event.kind === 'coverage-start' || event.kind === 'process-start');
    const complete = !invalid && !conflicting && run !== undefined && roots.length > 0 && starts.every(start => observed.some(end => end.kind === (start.kind === 'coverage-start' ? 'coverage-end' : 'process-end') && end.pid === start.pid && end.healthy === true)) && !observed.some(event => event.kind === 'unknown' || event.healthy === false);
    const counts = Object.fromEntries(roles.map(role => [role, observed.filter(event => event.kind === 'spawn' && event.role === role).length]));
    const services = {
      attempts: observed.filter(event => event.kind === 'attempt' && event.role === 'service').length,
      ready: observed.filter(event => event.kind === 'service-ready').length,
      reusedConnections: observed.filter(event => event.kind === 'service-reuse').length,
    };
    return { file, status: complete ? 'complete' : 'unknown', counts: complete ? counts : null, observed: counts, services: complete ? services : null, observedServices: services };
  };
  const values = [...unique.values()];
  const reports = selected.map(file => ({ ...summarize(file, values.filter(event => resolve(event.file) === file)), layer: classifyTestLayer(file) ?? 'unknown' }));
  return { run: run ?? null, status: reports.every(file => file.status === 'complete') && !invalid && !conflicting && run !== undefined ? 'complete' : 'unknown', invalidEvents: invalid, conflictingEvents: conflicting,
    files: reports,
    layers: testLayers.map(layer => {
      const selectedFiles = reports.filter(file => file.layer === layer);
      const group = selectedFiles;
      const complete = group.length > 0 && group.every(file => file.status === 'complete');
      const observed = Object.fromEntries(roles.map(role => [role, group.reduce((sum, file) => sum + (file.observed[role] ?? 0), 0)]));
      const observedServices = { attempts: group.reduce((sum, file) => sum + file.observedServices.attempts, 0), ready: group.reduce((sum, file) => sum + file.observedServices.ready, 0), reusedConnections: group.reduce((sum, file) => sum + file.observedServices.reusedConnections, 0) };
      return { layer, files: selectedFiles.length, status: complete ? 'complete' : 'unknown', counts: complete ? observed : null, observed, services: complete ? observedServices : null, observedServices };
    }),
  };
}

/** Bad or missing telemetry is diagnostic uncertainty, never a replacement for the test result. */
export const writeProcessEventReport = Effect.fn('test.processEvents.report')(function*(output: string, files: readonly string[]) {
  const fs = yield* FileSystem.FileSystem;
  let run: string | undefined, directory: string | undefined, invalid = false;
  const metadata = yield* fs.readFileString(join(output, 'process-event-run.json')).pipe(Effect.option);
  if (metadata._tag === 'Some') {
    const decoded = Schema.decodeUnknownExit(Schema.fromJsonString(Run), { onExcessProperty: 'error' })(metadata.value);
    if (decoded._tag === 'Success') { run = decoded.value.run; directory = decoded.value.directory; } else invalid = true;
  } else { run = process.env.CONCORD_TEST_RUN_ID; directory = process.env.CONCORD_TEST_EVENT_DIRECTORY; }
  directory ??= join(output, 'process-events');
  const entries = yield* fs.readDirectory(directory).pipe(Effect.catch(() => { invalid = true; return Effect.succeed<string[]>([]); }));
  const events: ProcessEvent[] = [];
  for (const entry of entries.filter(entry => entry.endsWith('.jsonl')).sort()) {
    const path = join(directory, entry);
    const stat = yield* fs.stat(path).pipe(Effect.option);
    if (stat._tag === 'None' || stat.value.size > BigInt(PROCESS_EVENT_FILE_LIMIT)) { invalid = true; continue; }
    const content = yield* fs.readFileString(path).pipe(Effect.option);
    if (content._tag === 'None') { invalid = true; continue; }
    for (const line of content.value.split('\n').filter(Boolean)) {
      const decoded = Schema.decodeUnknownExit(Schema.fromJsonString(ProcessEvent), { onExcessProperty: 'error' })(line);
      if (decoded._tag === 'Success') events.push(decoded.value); else invalid = true;
    }
  }
  const report = summarizeProcessEvents(files, events, run, invalid);
  yield* fs.writeFileString(join(output, 'process-counts.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
});
