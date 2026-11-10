import { Effect, Schema, type Scope } from 'effect';
import { bench } from 'mitata';
import { executeViewAction, getViewFile, getViewGitStatus, getWorkspaceSnapshot, type GitBaselineCache } from '../src/app/index.ts';
import { digest } from '../src/model/index.ts';
import { documentBody, featurePath, repositoryFixture } from './fixtures/index.ts';
import { runBenchmarks } from './run.ts';

const Mutation = Schema.Struct({ changedPaths: Schema.Array(Schema.String) });
export function registerBenchmarks(scope: Scope.Scope): void {
  // Representative frozen repository, real app operations; no HTTP/CLI latency claims.
  bench('web-workbench/file-read', async function*() {
    const fixture = await repositoryFixture(scope);
    yield async () => {
      const file = await fixture.runtime.runPromise(getViewFile(fixture.root, featurePath));
      if (file.body !== documentBody) throw new Error('Unexpected page source');
      return file;
    };
    await fixture.close();
  });
  bench('web-workbench/git-status', async function*() {
    const fixture = await repositoryFixture(scope);
    const cache: GitBaselineCache = {};
    yield async () => fixture.runtime.runPromise(getViewGitStatus(fixture.root, cache));
    await fixture.close();
  });
  bench('web-workbench/document-write', async function*() {
    const fixture = await repositoryFixture(scope);
    const bodies = [documentBody, `${documentBody}\nA new current fact.\n`] as const;
    const digests = [digest(bodies[0]), digest(bodies[1])] as const;
    let step = 0;
    // Alternates between two valid states via CAS expectedDigest without disk rename/readback overhead.
    yield async () => {
      const current = (step % 2) as 0 | 1;
      const next = ((step + 1) % 2) as 0 | 1;
      step++;
      const result = await fixture.runtime.runPromise(
        executeViewAction(fixture.root, {
          action: 'document.set',
          path: featurePath,
          body: bodies[next],
          expectedDigest: digests[current],
        }).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Mutation, { onExcessProperty: 'ignore' })),
        ),
      );
      if (!result.changedPaths.includes(featurePath)) throw new Error('Document write did not publish');
      return result;
    };
    await fixture.close();
  });
  bench('web-workbench/workspace-build', async function*() {
    const fixture = await repositoryFixture(scope);
    yield async () => {
      const snapshot = await fixture.runtime.runPromise(getWorkspaceSnapshot(fixture.root, 'use'));
      if (!snapshot.complete || snapshot.documents.length !== 110) throw new Error(JSON.stringify(snapshot.findings));
      return snapshot;
    };
    await fixture.close();
  });
}
if (import.meta.main) runBenchmarks(registerBenchmarks);
