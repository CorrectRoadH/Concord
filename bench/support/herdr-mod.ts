import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { NodeServices } from '@effect/platform-node';
import { Effect, Exit, FileSystem, ManagedRuntime, Schema, Scope, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { ModSession, type ModHost } from '../../src/entry/herdr-mod/index.ts';
import { renderDocument } from '../../src/model/index.ts';

export const featurePath = 'docs/feature/measured/README.md';
export const documentBodies = [
  '# Measured\n\n' + 'The current document remains readable after a repository refresh.\n\n'.repeat(62),
  '# Measured\n\n' + 'The updated document remains readable after a repository refresh.\n\n'.repeat(62),
] as const;
const entry = fileURLToPath(new URL('../../src/entry/cli/entry.ts', import.meta.url));

export class ModBenchmarkFailure extends Schema.TaggedError<ModBenchmarkFailure>()('ModBenchmarkFailure', {
  message: Schema.String,
}) {}

/** Only the external exec boundary changes; the session still decodes public CLI replies. */
const execute = Effect.fn('herdrModBenchmark.execute')(function*(root: string, command: string, args: readonly string[]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const argv = command === 'concord'
    ? [process.execPath, '--no-env-file', '--config=/dev/null', entry, ...args]
    : [command, ...args];
  const child = yield* spawner.spawn(ChildProcess.make(argv[0]!, argv.slice(1), {
    cwd: root, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  }));
  const reply = yield* Effect.all({
    code: child.exitCode,
    stdout: Stream.mkString(Stream.decodeText(child.stdout)),
    stderr: Stream.mkString(Stream.decodeText(child.stderr)),
  }, { concurrency: 'unbounded' });
  return { ...reply, code: Number(reply.code) };
}, Effect.scoped, Effect.timeout('30 seconds'));

/** The child scope is attached before acquiring directories or starting any service. */
export async function modRepositoryFixture(parent: Scope.Scope) {
  const scope = await Effect.runPromise(Scope.fork(parent, 'sequential'));
  const runtime = ManagedRuntime.make(NodeServices.layer);
  await Effect.runPromise(Scope.addFinalizer(scope, runtime.disposeEffect));
  const command = (root: string, args: readonly string[]) => execute(root, 'concord', ['--json', '--root', root, ...args]);
  const requireSuccess = Effect.fn('herdrModBenchmark.requireSuccess')(function*(root: string, args: readonly string[]) {
    const reply = yield* command(root, args);
    if (reply.code !== 0) return yield* Effect.fail(new ModBenchmarkFailure({ message: `${args[0]} failed in ${root}: ${reply.stdout}${reply.stderr}` }));
    return reply;
  });
  try {
    const roots = await runtime.runPromise(Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectory({ prefix: 'concord-mod-bench-' });
      const roots = [join(directory, 'first'), join(directory, 'second')] as const;
      const started: string[] = [];
      yield* Effect.addFinalizer(() => Effect.gen(function*() {
        // Try every owned service; retain sources and report failures if any stop is unconfirmed.
        const stopped = yield* Effect.forEach(started, root => Effect.result(requireSuccess(root, ['server', 'stop'])));
        const failures = stopped.filter(result => result._tag === 'Failure');
        if (failures.length) return yield* Effect.fail(new ModBenchmarkFailure({ message: `Service cleanup failed; retained ${directory}: ${JSON.stringify(failures)}` }));
        yield* fs.remove(directory, { recursive: true });
      }).pipe(Effect.orDie));
      for (const root of roots) {
        yield* fs.makeDirectory(root);
        const git = yield* execute(root, 'git', ['init', '-q']);
        if (git.code !== 0) return yield* Effect.fail(new ModBenchmarkFailure({ message: git.stderr }));
        started.push(root);
        yield* requireSuccess(root, ['init', '--yes']);
        yield* fs.makeDirectory(join(root, 'docs/feature/measured'), { recursive: true });
        yield* fs.writeFileString(join(root, featurePath), renderDocument({
          format: 'concord.document/v1', kind: 'feature', id: 'measured', title: 'Measured',
        }, documentBodies[0]));
      }
      return roots;
    }).pipe(Scope.provide(scope)));
    const host: ModHost = {
      exec(command, args, options) {
        if (command !== 'concord' || options.on !== null || !roots.some(root => root === options.cwd)) {
          return Promise.reject(new ModBenchmarkFailure({ message: 'Benchmark exec escaped its local consumer repositories' }));
        }
        return runtime.runPromise(execute(options.cwd!, command, args));
      },
    };
    // A completed product refresh establishes service and projection readiness without a sleep.
    for (const root of roots) {
      const session = new ModSession(host, root);
      try {
        await Effect.runPromise(session.refresh());
        if (!session.loaded || !session.initialized || !session.documents.some(item => item.path === featurePath)) {
          throw new ModBenchmarkFailure({ message: `Fixture projection is not ready: ${root}` });
        }
      } finally { session.stop(); }
    }
    return { roots, host, close: () => Effect.runPromise(Scope.close(scope, Exit.void)) };
  } catch (error) {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    throw error;
  }
}
