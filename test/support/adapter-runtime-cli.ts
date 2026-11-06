import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import { runCli } from './cli.ts';
import { CaseList, requireCommand, text } from './test-adapters-consumer-fixture.ts';

/** Preserve the fixture's transport limits while waiting for interrupted CLI scopes. */
export const call = Effect.fn('adapterRuntime.cli')(function* (root: string, args: readonly string[]) {
  let pending: ReturnType<typeof runCli> | undefined;
  return yield* Effect.tryPromise({
    try: async signal => {
      pending = runCli({ argv: ['--root', root, '--json', ...args], cwd: root, env: { ...process.env }, signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) });
      const result = await pending;
      const bytes = Buffer.byteLength(result.stdout, 'utf8') + Buffer.byteLength(result.stderr, 'utf8');
      if (bytes > 8 * 1024 * 1024) throw new Error(`Adapter CLI output exceeds 8 MiB: ${bytes} bytes`);
      return result;
    },
    catch: cause => cause instanceof Error ? cause : new Error(String(cause)),
  }).pipe(Effect.ensuring(Effect.promise(async () => {
    if (pending !== undefined) await pending.then(() => undefined, () => undefined);
  })));
});

export const success = Effect.fn('adapterRuntime.success')(function* (root: string, args: readonly string[]) {
  const result = yield* call(root, args);
  assert.equal(result.exitCode, 0, `${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
  return result;
});

export const idFor = Effect.fn('adapterRuntime.id')(function* (root: string) {
  const list = yield* success(root, ['test', 'list']);
  return Schema.decodeUnknownSync(CaseList)(JSON.parse(list.stdout)).cases[0]!.id;
});

export const prepare = Effect.fn('adapterRuntime.consumer')(function* (scratch: string, name: string, tool: string) {
  const root = join(scratch, name);
  yield* Effect.sync(() => mkdirSync(root));
  yield* requireCommand(['git', 'init', '-q'], root);
  yield* success(root, ['init']);
  yield* success(root, ['new', 'feature', 'example', '--title', 'Example']);
  // Queries may own a real workspace service; stop it before scratch removes its sources.
  yield* Effect.addFinalizer(() => success(root, ['server', 'stop']).pipe(Effect.asVoid, Effect.orDie));
  yield* Effect.sync(() => {
    text(root, 'package.json', '{"private":true,"type":"module"}');
    symlinkSync(join(tool, 'node_modules'), join(root, 'node_modules'), 'dir');
    text(root, '.gitignore', 'node_modules\n**/target/\n**/__pycache__/\n**/.pytest_cache/\n');
  });
  return root;
});
