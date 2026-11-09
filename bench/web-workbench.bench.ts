import { Effect, FileSystem, Schema, type Scope } from 'effect';
import { join } from 'node:path';
import { bench } from 'mitata';
import { executeViewAction, getViewFile, getViewGitStatus, getWorkspaceSnapshot } from '../src/app/index.ts';
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
    yield async () => fixture.runtime.runPromise(getViewGitStatus(fixture.root));
    await fixture.close();
  });
  bench('web-workbench/document-write', async function*() {
    const fixture = await repositoryFixture(scope);
    const changedBody = `${documentBody}\nA new current fact.\n`;
    // Reset by rename and then publish different bytes every callback; reset/readback cost is INCLUDED.
    yield async () => fixture.runtime.runPromise(Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem;
      const target = join(fixture.root, featurePath), temporary = `${target}.benchmark-tmp`;
      yield* fs.writeFileString(temporary, documentBody);
      yield* fs.rename(temporary, target);
      const result = yield* executeViewAction(fixture.root, { action: 'document.set', path: featurePath, body: changedBody, expectedDigest: digest(documentBody) });
      const receipt = yield* Schema.decodeUnknownEffect(Mutation, { onExcessProperty: 'ignore' })(result);
      if (!receipt.changedPaths.includes(featurePath) || (yield* fs.readFileString(target)) !== changedBody) throw new Error('Document write did not publish its changed body');
      return receipt;
    }));
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
