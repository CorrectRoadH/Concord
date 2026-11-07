// @concord-file
// @concord-implements docs/engineering/build/architecture.md#编译入口
import { Effect, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { join } from 'node:path';

const Receipt = Schema.Struct({ stdout: Schema.String, stderr: Schema.String, status: Schema.Int });

/** Capture the real parser under the exact environment accepted by the fast path. */
export const compiledStartupReceipts = Effect.fn('build.compiledStartupReceipts')(function*(repository: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const receipts: Record<string, typeof Receipt.Type> = {};
  for (const args of [['--help'], ['-h'], ['--version'], ['-v']]) {
    const receipt = yield* Effect.scoped(Effect.gen(function*() {
      const child = yield* spawner.spawn(ChildProcess.make('bun', ['--no-env-file', '--config=/dev/null', join(repository, 'src/entry/cli/entry.ts'), ...args], {
        cwd: repository, env: { ...process.env, NO_COLOR: '1', TERM: 'dumb', FORCE_COLOR: undefined, NODE_OPTIONS: undefined, BUN_OPTIONS: undefined },
        stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
      }));
      const result = yield* Effect.all({ stdout: Stream.mkString(Stream.decodeText(child.stdout)), stderr: Stream.mkString(Stream.decodeText(child.stderr)), status: child.exitCode }, { concurrency: 'unbounded' });
      return yield* Schema.decodeUnknownEffect(Receipt)({ ...result, status: Number(result.status) });
    })).pipe(Effect.timeout('30 seconds'));
    receipts[JSON.stringify(args)] = receipt;
  }
  return receipts;
});
