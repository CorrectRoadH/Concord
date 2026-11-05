import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { io } from '../scripts/perf/process.js';
import { Effect, Schema } from 'effect';
import { defineBenchmarks, type BenchScenario } from '../scripts/perf/scenario.js';
import { prepareView, WorkspaceResponse } from './fixtures/view.js';
const Response = Schema.Struct({ ok: Schema.Literal(true), value: Schema.Json });
const actionBody = (context: Parameters<typeof prepareView>[0]) => {
  const path = 'docs/feature/measured/format/page-0.md', body = readFileSync(join(context.consumer.root, path), 'utf8');
  return { action: 'document.set', path, body, expectedDigest: `sha256:${createHash('sha256').update(body).digest('hex')}` };
};
const requests = [
  { name: 'workspace', path: 'api/workspace' },
  { name: 'jobs', path: 'api/jobs', delayMs: 10 },
  { name: 'file', path: 'api/file?path=docs%2Ffeature%2Fmeasured%2Fformat%2Fpage-0.md', delayMs: 10 },
  { name: 'document-set', path: 'api/action', delayMs: 10, body: actionBody },
];
const scenarios: BenchScenario[] = requests.map(({ name, ...request }) => ({
  id: `web-workbench/${name}`, consumer: 'fixture:web', state: 'warm',
  prepare: context => context.smoke ? prepareView(context) : Effect.succeed(undefined),
  beforeEach: context => context.smoke ? Effect.succeed(undefined) : prepareView(context),
  run: { request: { ...request, companions: requests.filter(other => other.name !== name).map(({ name: _name, ...other }) => other) } },
  expect: { exitCode: 0, json: name === 'workspace' ? WorkspaceResponse : Response },
}));
const actionArgv = ['action', '--input', ''];
export default defineBenchmarks('web-workbench', [
  ...scenarios,
  { id: 'web-workbench/action', consumer: 'fixture:web', state: 'warm',
    prepare: context => io('Prepare shared action input', () => {
      const path = 'docs/feature/measured/format/page-0.md', body = readFileSync(join(context.consumer.root, path), 'utf8');
      actionArgv[2] = join(context.outputDir, 'action-input.json');
      writeFileSync(actionArgv[2]!, JSON.stringify({ action: 'document.set', path, body, expectedDigest: `sha256:${createHash('sha256').update(body).digest('hex')}` }));
    }), run: actionArgv, expect: { exitCode: 0 } },
  { id: 'web-workbench/git-status', consumer: 'self', state: 'warm', run: ['git', 'status'], expect: { exitCode: 0 } },
  { id: 'web-workbench/workspace-projection', consumer: 'fixture:web', state: 'warm',
    prepare: context => prepareView(context).pipe(Effect.scoped),
    beforeEach: context => prepareView(context).pipe(Effect.scoped),
    run: ['workspace', 'projection', '--json'], expect: { exitCode: 0 } },
]);
