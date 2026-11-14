// External collection boundary for dependency mutation; no host dependencies.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
assert.notEqual(process.stdin.isTTY, true);
const mutate = (step: string) => {
  if (readFileSync('mutation.txt', 'utf8') === step) {
    writeFileSync('node_modules/changed-by-adapter', step);
    process.stderr.write(`modified dependencies during ${step}\n`);
  }
};
if (process.argv[2] === 'invoke') {
  const stage = process.argv[3]!;
  mutate(stage);
} else {
  const request = JSON.parse(readFileSync(0, 'utf8'));
  mutate(request.op);
  const caps = { realCollection: true, leaf: true, parameterGroups: true, range: true, rangeTrivia: true, tags: true };
  const invocation = { invocationId: 'collect', argv: [process.execPath, 'adapter.ts', 'invoke', 'collect'], cwd: '.', envNames: ['PATH'], reports: [] };
  let payload: unknown;
  if (request.op === 'collect-plan') payload = { invocations: [invocation], planContext: { files: request.payload.files } };
  if (request.op === 'collect-parse') {
    const file = request.payload.planContext.files[0];
    const source = readFileSync(file, 'utf8');
    payload = { cases: [{ nativeId: 'fixture:cart', project: 'fixture', file, kind: 'leaf', range: { startLine: 1, endLine: source.split('\n').length, sourceDigest: `sha256:${createHash('sha256').update(source).digest('hex')}` }, tags: {}, provenance: 'fixture/1' }], capabilities: caps, completeness: { complete: true, gaps: [] } };
  }
  process.stdout.write(JSON.stringify({ format: request.format, op: request.op, requestId: request.requestId, planId: request.context.planId, inputs: request.context.inputs, payload }) + '\n');
}
