// @concord-file
// @concord-implements docs/feature/local-sdlc/format.md#状态图块
import { Effect } from 'effect';
import { openReadRepository } from '../base/workspace/index.ts';
import { inspectStatechart, loadStatechartArtifacts } from '../domain/documents/index.ts';
import { ConcordError, decode, failure, StatechartRequest, type StatechartResolution } from '../model/index.ts';
import { getViewFile } from './application.ts';

export const resolveStatechart = Effect.fn('view.resolveStatechart')(function*(root: string, input: unknown) {
  const block = yield* Effect.try({ try: () => decode(StatechartRequest, input, 'statechart request'), catch: failure });
  if (!block.document.endsWith('.md')) return yield* Effect.fail(new ConcordError('InvalidInput', 'Statechart blocks belong to Markdown documents'));
  const document = yield* getViewFile(root, block.document);
  const repo = yield* openReadRepository(root, { access: 'read' });
  return yield* Effect.try({
    try: (): StatechartResolution => repo.snapshot(() => loadStatechartArtifacts(repo,
      inspectStatechart(repo, { ...block, document: document.path, line: 1 }).result)),
    catch: failure,
  });
}, Effect.scoped);
