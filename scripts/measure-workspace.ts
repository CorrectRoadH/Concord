import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cpus, totalmem } from 'node:os';

const main = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const baseline = yield* Schema.decodeUnknownEffect(Schema.String.check(Schema.isMinLength(1)))(process.argv[2]);
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-workspace-measure-' });
  for (const command of [['git', 'init', '-q', root], [process.execPath, resolve('dist/entry.js'), '--root', root, 'init', '--test-root', 'test', '--source-root', 'src']]) {
    const status = yield* spawner.exitCode(ChildProcess.make(command[0]!, command.slice(1), { stdout: 'ignore', stderr: 'inherit' }));
    if (status !== 0) return yield* Effect.fail(new Error(`Fixture command failed: ${status}`));
  }
  yield* fs.makeDirectory(join(root, 'src'), { recursive: true });
  yield* fs.makeDirectory(join(root, 'test'), { recursive: true });
  for (let index = 0; index < 1072; index++) for (const folder of ['src', 'test']) {
    yield* fs.writeFileString(join(root, folder, `${index}.ts`), `export const value${index} = ${index};\n`);
  }
  for (const args of [['add', '.'], ['-c', 'user.name=Concord benchmark', '-c', 'user.email=benchmark@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Frozen workspace benchmark']]) {
    const status = yield* spawner.exitCode(ChildProcess.make('git', ['-C', root, ...args], { stdout: 'ignore', stderr: 'inherit' }));
    if (status !== 0) return yield* Effect.fail(new Error('Cannot freeze benchmark fixture'));
  }
  const fixtureCommit = (yield* spawner.string(ChildProcess.make('git', ['-C', root, 'rev-parse', 'HEAD']))).trim();
  const samples: Record<string, { workspaceMs: number; competingRequestMs: number }[]> = {};
  const servers = [];
  for (const [label, directory] of [['baseline', baseline], ['candidate', process.cwd()]] as const) {
    const module: typeof import('../src/view-server.js') = yield* Effect.tryPromise(() => import(pathToFileURL(join(directory, 'dist/view-server.js')).href));
    const server = yield* Effect.acquireRelease(Effect.tryPromise(() => module.startViewServer({ root, host: '127.0.0.1', port: 0 })), server => Effect.promise(() => server.close()));
    servers.push({ label, server });
    samples[label] = [];
  }
  for (let round = -1; round < 7; round++) for (const { label, server } of servers) {
    const result = yield* Effect.tryPromise(async () => {
      const base = `http://127.0.0.1:${server.port}`;
      const started = performance.now();
      const workspace = fetch(`${base}/api/workspace`).then(async response => {
        if (!response.ok) throw new Error(await response.text());
        await response.arrayBuffer();
        return performance.now() - started;
      });
      const competing = new Promise<number>((accept, reject) => setTimeout(() => {
        void fetch(`${base}/api/file?path=docs%2Fconstitution.md`).then(async response => {
          if (!response.ok) throw new Error(await response.text());
          await response.arrayBuffer();
          accept(performance.now() - started - 50);
        }).catch(reject);
      }, 50));
      const [workspaceMs, competingRequestMs] = await Promise.all([workspace, competing]);
      return { workspaceMs, competingRequestMs };
    });
    if (round >= 0) samples[label]!.push(result);
  }
  const cliSamples: Record<string, Record<string, number[]>> = {};
  for (const command of ['code', 'test']) {
    cliSamples[command] = { baseline: [], candidate: [] };
    for (let round = -1; round < 7; round++) for (const [label, directory] of [['baseline', baseline], ['candidate', process.cwd()]] as const) {
      const started = performance.now();
      const status = yield* spawner.exitCode(ChildProcess.make(process.execPath, [join(directory, 'dist/entry.js'), '--root', root, command, 'list', '--json'], { stdout: 'ignore', stderr: 'inherit' }));
      if (status !== 0) return yield* Effect.fail(new Error(`${label} ${command} list failed`));
      if (round >= 0) cliSamples[command]![label]!.push(performance.now() - started);
    }
  }
  yield* Effect.sync(() => process.stdout.write(`${JSON.stringify({ node: process.version, platform: process.platform, cpu: cpus()[0]?.model, memoryBytes: totalmem(), fixtureCommit, sourceFiles: 1072, testFiles: 1072, samples, cliSamples })}\n`));
});

main.pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
