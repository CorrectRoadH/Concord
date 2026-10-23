import { readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

const Hash = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const Request = Schema.Struct({ format: Schema.Literal('concord.test-adapter/v1'), op: Schema.String, requestId: Schema.String, context: Schema.Struct({ root: Schema.String, runId: Schema.String, planId: Schema.String, inputs: Schema.String, reportDirectory: Schema.String }), payload: Schema.Record(Schema.String, Schema.Unknown) });
const caps = { realCollection: true, leaf: true, parameterGroups: true, exactSelection: true, perItemReport: true, range: true, rangeTrivia: true, tags: true, skipVisibility: true };
const main = Effect.gen(function* () {
  const root = process.cwd();
  const mode = yield* Effect.sync(() => readFileSync(join(root, 'mode.txt'), 'utf8').trim());
  if (process.argv[2] === 'invoke') {
    yield* Effect.sync(() => {
      const stage = process.argv[3], directory = process.argv[4]!;
      if (stage === 'collect') {
        if (mode === 'drift') writeFileSync(join(root, 'fixture.txt'), 'changed');
        if (mode === 'drift-config') writeFileSync(join(root, 'concord.config.ts'), readFileSync(join(root, 'concord.config.ts'), 'utf8') + '\n');
        if (mode === 'drift-lock') writeFileSync(join(root, 'fixture.lock'), 'changed');
        if (mode === 'drift-member') writeFileSync(join(root, 'test/added.ts'), '// new member');
      }
      if (stage === 'run' && mode === 'symlink') symlinkSync(join(root, 'fixture.txt'), join(directory, 'results.json'));
      else if (stage === 'run' && mode === 'hardlink') { /* tested directly at the report boundary */ }
      else if (stage === 'run' && mode === 'unexpected-report') writeFileSync(join(directory, 'old.json'), '{}');
      else if (stage === 'run') writeFileSync(join(directory, 'results.json'), mode === 'large-report' ? 'x'.repeat(1024) : '{}');
      process.exitCode = stage === 'run' && mode === 'red' && !process.argv[5]?.endsWith(':two') ? 1 : 0;
    });
    return;
  }
  const request = yield* Effect.sync(() => Schema.decodeUnknownSync(Request, { onExcessProperty: 'error' })(JSON.parse(readFileSync(0, 'utf8'))));
  if (mode === 'timeout' && request.op === 'collect-plan') { yield* Effect.sleep('5 seconds'); return; }
  const files = request.payload.files as readonly string[] | undefined;
  const requested = (request.payload.nativeIds ?? request.payload.requested) as readonly string[] | undefined;
  const invocation = (stage: string, nativeIds?: readonly string[], index?: number) => ({ invocationId: index === undefined ? stage : `${stage}-${index}`, argv: [process.execPath, 'adapter.ts', 'invoke', stage, join(request.context.reportDirectory, index === undefined ? stage : `${stage}-${index}`), nativeIds?.[0] ?? 'none'], cwd: '.', envNames: ['PATH'], reports: stage === 'run' ? mode === 'escape-report' ? ['../escape'] : ['results.json'] : [], ...(nativeIds ? { requested: nativeIds } : {}) });
  let payload: unknown;
  if (request.op === 'collect-plan') payload = { invocations: [invocation('collect')], planContext: { files } };
  else if (request.op === 'collect-parse') {
    const file = (request.payload.planContext as { files: readonly string[] }).files[0]!;
    const source = readFileSync(join(root, file), 'utf8');
    payload = { cases: ['fake:binary-a:one', 'fake:binary-b:two'].map(nativeId => ({ nativeId, project: 'fixture', file, kind: 'leaf', group: 'parameters', range: { startLine: 1, endLine: source.split(/\r?\n/u).length, sourceDigest: Hash(source) }, selection: { opaqueId: nativeId, capabilityVersion: 'fixture/v1' }, tags: { tag: 'not-a-relation' }, provenance: 'fixture/v1' })), capabilities: caps, completeness: { complete: true, gaps: [] } };
  } else if (request.op === 'select-plan') payload = { invocations: mode === 'split' ? requested!.map((id, index) => invocation('run', [id], index)) : [invocation('run', requested)], planContext: {} };
  else if (request.op === 'report-parse') {
    if (mode === 'parser-failed') throw new Error('broken report codec');
    let ids = [...requested!];
    if (mode === 'missing') ids.pop();
    if (mode === 'duplicate') ids.push(ids[0]!);
    if (mode === 'extra') ids.push('fake:extra');
    payload = { observed: ids.map((nativeId, index) => ({ nativeId, outcome: mode === 'skip' ? 'skipped' : mode === 'red' && index === 0 ? 'failed' : 'passed', provenance: 'fixture/v1' })), capabilities: caps, completeness: { complete: true, gaps: [] } };
  }
  yield* Effect.sync(() => {
    const response = { format: request.format, op: request.op, requestId: request.requestId, planId: request.context.planId, inputs: mode === 'wrong-echo' ? 'sha256:' + '0'.repeat(64) : request.context.inputs, payload, ...(mode === 'extra-envelope' ? { unknown: true } : {}) };
    let json = JSON.stringify(response);
    if (mode === 'duplicate-key') json = json.replace('"op":', '"op":"collect-plan","op":');
    if (mode === 'nonfinite') json = json.replace('"payload":', '"nonfinite":1e999,"payload":');
    process.stdout.write(json + '\n');
  });
});
await Effect.runPromise(main).catch(error => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });
