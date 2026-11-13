// External adapter boundary for verification protection; no host dependencies.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
assert.equal(process.env.CONCORD_VERIFICATION, '1');
assert.equal(process.env.pnpm_config_verify_deps_before_run, 'false');
assert.equal(process.env.npm_config_verify_deps_before_run, 'false');
assert.notEqual(process.stdin.isTTY, true);
const mutate = (step: string) => {
  if (readFileSync('mutation.txt', 'utf8') === step) {
    writeFileSync('node_modules/changed-by-adapter', step);
    process.stderr.write(`modified dependencies during ${step}\n`);
  }
};
const red = readFileSync('src/cart.ts', 'utf8').includes('= 1;');
if (process.argv[2] === 'invoke') {
  const stage = process.argv[3]!;
  mutate(stage);
  if (stage === 'run') writeFileSync(join(process.argv[4]!, 'results.json'), '{}');
  process.exitCode = stage === 'run' && red ? 1 : 0;
} else {
  const request = JSON.parse(readFileSync(0, 'utf8'));
  mutate(request.op);
  const caps = { realCollection: true, leaf: true, parameterGroups: true, exactSelection: true, perItemReport: true, range: true, rangeTrivia: true, tags: true, skipVisibility: true };
  const invocation = (stage: string, requested?: string[]) => ({ invocationId: stage, argv: [process.execPath, 'adapter.ts', 'invoke', stage, join(request.context.reportDirectory, stage)], cwd: '.', envNames: ['PATH'], reports: stage === 'run' ? ['results.json'] : [], ...(requested ? { requested } : {}) });
  let payload: unknown;
  if (request.op === 'collect-plan') payload = { invocations: [invocation('collect')], planContext: { files: request.payload.files } };
  if (request.op === 'collect-parse') {
    const file = request.payload.planContext.files[0];
    const source = readFileSync(file, 'utf8');
    payload = { cases: [{ nativeId: 'fixture:cart', project: 'fixture', file, kind: 'leaf', range: { startLine: 1, endLine: source.split('\n').length, sourceDigest: `sha256:${createHash('sha256').update(source).digest('hex')}` }, selection: { opaqueId: 'fixture:cart', capabilityVersion: '1' }, tags: {}, provenance: 'fixture/1' }], capabilities: caps, completeness: { complete: true, gaps: [] } };
  }
  if (request.op === 'select-plan') payload = { invocations: [invocation('run', request.payload.nativeIds)], planContext: {} };
  if (request.op === 'report-parse') payload = { observed: request.payload.requested.map((nativeId: string) => ({ nativeId, outcome: red ? 'failed' : 'passed', provenance: 'fixture/1' })), capabilities: caps, completeness: { complete: true, gaps: [] } };
  process.stdout.write(JSON.stringify({ format: request.format, op: request.op, requestId: request.requestId, planId: request.context.planId, inputs: request.context.inputs, payload }) + '\n');
}
