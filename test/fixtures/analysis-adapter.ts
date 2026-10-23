import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

const Request = Schema.Struct({
  format: Schema.Literal('concord.test-adapter/v1'), op: Schema.String, requestId: Schema.String,
  context: Schema.Struct({ root: Schema.String, runId: Schema.String, planId: Schema.String, inputs: Schema.String, reportDirectory: Schema.String }),
  payload: Schema.Record(Schema.String, Schema.Unknown),
});
const main = Effect.sync(() => {
  if (process.argv.includes('--collect')) return;
  const request = Schema.decodeUnknownSync(Request, { onExcessProperty: 'error' })(JSON.parse(readFileSync(0, 'utf8')));
  let payload: unknown;
  if (request.op === 'collect-plan') {
    const files = Schema.decodeUnknownSync(Schema.NonEmptyArray(Schema.String))(request.payload.files);
    payload = { invocations: [{ invocationId: 'collect', argv: [process.execPath, 'analysis-adapter.mjs', '--collect'], cwd: '.', envNames: [], reports: [] }], planContext: { file: files[0] } };
  } else if (request.op === 'collect-parse') {
    const { file } = Schema.decodeUnknownSync(Schema.Struct({ file: Schema.String }))(request.payload.planContext);
    const mode = readFileSync(process.env.ANALYSIS_ADAPTER_STATE!, 'utf8').trim();
    const source = readFileSync(join(request.context.root, file));
    const range = { startLine: mode === 'second' ? 7 : 4, endLine: mode === 'second' ? 9 : 6, sourceDigest: `sha256:${createHash('sha256').update(source).digest('hex')}` };
    payload = {
      cases: [{ nativeId: 'fixture:selected', project: 'fixture', file, kind: 'leaf', ...(mode === 'no-range' ? {} : { range }), selection: { opaqueId: 'selected', capabilityVersion: 'fixture/v1' }, tags: {}, provenance: 'fixture/v1' }],
      capabilities: { realCollection: true, leaf: true, parameterGroups: false, exactSelection: true, perItemReport: true, range: mode !== 'no-range', rangeTrivia: false, tags: false, skipVisibility: true },
      completeness: { complete: true, gaps: [] },
    };
  } else throw new Error('This fixture only collects ranges');
  process.stdout.write(JSON.stringify({ format: request.format, op: request.op, requestId: request.requestId, planId: request.context.planId, inputs: request.context.inputs, payload }) + '\n');
});
await Effect.runPromise(main);
