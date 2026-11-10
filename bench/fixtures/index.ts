import { join, dirname } from 'node:path';
import { cpSync, rmSync } from 'node:fs';
import { NodeServices } from '@effect/platform-node';
import { ConfigProvider, Effect, Exit, FileSystem, Layer, ManagedRuntime, Scope } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { PersistentCache } from '../../src/base/cache/index.ts';
import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { Git } from '../../src/base/git/index.ts';
import { Installation } from '../../src/base/installation/index.ts';
import { OwnedProcessLive } from '../../src/base/process/index.ts';
import { Publication } from '../../src/base/publication/index.ts';
import { Sources } from '../../src/base/sources/index.ts';
import { Workspace } from '../../src/base/workspace/index.ts';
import { PublicationValidationLive, executeQuery, initialize, rebuildCache } from '../../src/app/index.ts';
import { ConcordError, failure, renderDocument, renderWritingPolicy } from '../../src/model/index.ts';

/** Frozen representative input: 40 Features/Use Cases, 100 sources, 40 tests, 20 Memories, 10 Issues. */
export const featurePath = 'docs/feature/feature-0/README.md';
export const documentBody = '# Feature 0\n\nSnapshot keeps current facts. Read [Snapshot](../../concepts.md#snapshot) and follow [readable prose](../../taste.md#t-1).\n';
const publication = Publication.layer.pipe(Layer.provide(PublicationValidationLive));
const applicationLayer = (root: string) => {
  const runtime = makeRuntimeEnvironment(root, process.env);
  return Layer.mergeAll(PersistentCache.layer, Installation.layer, Workspace.layer, Sources.layer, Git.layer, publication).pipe(
    Layer.provideMerge(OwnedProcessLive),
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(RuntimeEnvironment.layer(runtime)),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(runtime.env))),
  );
};

const git = Effect.fn('bench.fixture.git')(function*(root: string, args: readonly string[]) {
  const child = yield* (yield* ChildProcessSpawner.ChildProcessSpawner).spawn(ChildProcess.make('git', ['-C', root, ...args], {
    stdin: 'ignore', stdout: 'inherit', stderr: 'inherit',
  }));
  const code = yield* child.exitCode;
  if (code !== 0) return yield* Effect.fail(new ConcordError('BenchmarkFixtureFailed', `git ${args[0]} exited ${code}`));
}, Effect.scoped);

let templatePromise: Promise<string> | undefined;

/** Builds a template repository once; subsequent fixtures clone it cheaply. */
async function buildTemplate(): Promise<string> {
  const runtime = ManagedRuntime.make(NodeServices.layer);
  const tempDir = await runtime.runPromise(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.makeTempDirectory({ prefix: 'concord-bench-template-' });
  }));

  const appRuntime = ManagedRuntime.make(applicationLayer(tempDir));
  try {
    await appRuntime.runPromise(Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem;
      yield* git(tempDir, ['init', '-q']);
      yield* Effect.scoped(Effect.gen(function*() {
        const repo = yield* (yield* Workspace).openWrite(tempDir, { initialize: true });
        yield* initialize(repo, false, { sourceRoots: ['src'], testRoots: ['test'] });
      }));
      const write = (path: string, body: string) => fs.makeDirectory(dirname(join(tempDir, path)), { recursive: true }).pipe(
        Effect.andThen(fs.writeFileString(join(tempDir, path), body)),
      );
      yield* write('docs/taste.md', '# Project taste\n\n## T-1 Readable prose {#t-1}\n\nReaders need concrete facts.\n\n- Good: a short example.\n- Bad: an ambiguous claim.\n');
      yield* write('docs/concepts.md', '# Project concepts\n\n## Snapshot {#snapshot}\n\nA captured set of current facts.\n');
      yield* write('docs/writing.md', renderWritingPolicy({ roots: ['docs/feature'], bannedTerms: [{ term: 'obsoleteword', use: 'Snapshot', why: 'Use the domain term.' }], sentenceLength: 300, paragraphLength: 500 }));
      for (let index = 0; index < 40; index++) {
        const id = `feature-${index}`, path = `docs/feature/${id}/README.md`;
        yield* write(path, renderDocument({ format: 'concord.document/v1', kind: 'feature', id, title: `Feature ${index}` }, documentBody.replace('# Feature 0', `# Feature ${index}`)));
        yield* write(`docs/feature/${id}/use-case/read.md`, renderDocument({ format: 'concord.document/v1', kind: 'use-case', id: 'read', title: 'Read', feature: path }, '# Read\n\n1. Read the current Snapshot.\n'));
        yield* write(`test/read-${index}.test.ts`, `import test from 'node:test';\n// @use-case docs/feature/${id}/use-case/read.md\ntest('reads ${index}', () => {});\n`);
      }
      for (let index = 0; index < 100; index++) {
        yield* write(`src/value-${index}.ts`, `// @concord-file\n// @concord-implements docs/feature/feature-${index % 40}/README.md\nexport const value${index} = ${index};\n`);
      }
      for (let index = 0; index < 20; index++) {
        yield* write(`memory/lesson-${index}.md`, renderDocument({ format: 'concord.document/v1', kind: 'memory', id: `lesson-${index}`, title: `Lesson ${index}`, relations: [] }, `# Lesson ${index}\n\nSnapshot measurements retain current facts and reusable evidence.\n`));
      }
      for (let index = 0; index < 10; index++) {
        yield* write(`docs/issues/observation-${index}.md`, renderDocument({ format: 'concord.document/v1', kind: 'issue', id: `observation-${index}`, title: `Observation ${index}`, relations: [], source: {
          provider: 'github', instance: 'https://api.github.com', id: String(index + 1), url: `https://github.com/example/project/issues/${index + 1}`, title: `Observation ${index}`, body: 'Captured remote observation.', state: 'open', updatedAt: '2026-11-09T00:00:00.000Z', connectionId: 'origin', importedAt: '2026-11-09T00:00:00.000Z',
        } }, `# Observation ${index}\n\nSnapshot observation remains local.\n`));
      }
      yield* git(tempDir, ['add', '.']);
      yield* git(tempDir, ['-c', 'user.name=Concord benchmark', '-c', 'user.email=benchmark@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Frozen representative input']);
      yield* Effect.scoped(Effect.gen(function*() {
        const repo = yield* (yield* Workspace).openWrite(tempDir);
        yield* Effect.tryPromise({ try: () => rebuildCache(repo), catch: failure });
      }));
      const check = yield* executeQuery(tempDir, { name: 'check', input: {} });
      if (check.exitCode !== 0) return yield* Effect.fail(new ConcordError('BenchmarkFixtureFailed', JSON.stringify(check.value)));
    }));
  } finally {
    await appRuntime.dispose();
  }
  return tempDir;
}

process.on('exit', () => {
  if (templatePromise) {
    templatePromise.then(dir => {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }).catch(() => {});
  }
});

/** A child scope is attached before acquisition; outer failure also releases a suspended generator. */
export async function repositoryFixture(parent: Scope.Scope) {
  const template = await (templatePromise ??= buildTemplate());
  const scope = await Effect.runPromise(Scope.fork(parent, 'sequential'));
  const root = await Effect.runPromise(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.makeTempDirectoryScoped({ prefix: 'concord-bench-' });
  }).pipe(Scope.provide(scope), Effect.provide(NodeServices.layer)));

  cpSync(template, root, { recursive: true });

  const runtime = ManagedRuntime.make(applicationLayer(root));
  await Effect.runPromise(Scope.addFinalizer(scope, runtime.disposeEffect));
  return { root, scope, runtime, close: () => Effect.runPromise(Scope.close(scope, Exit.void)) };
}
