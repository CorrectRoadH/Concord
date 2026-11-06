// @concord-file
// @concord-implements docs/engineering/testing/architecture.md#进程内-cli
import { Context, Effect, Layer, Ref, Stdio, Stream } from 'effect';

export class CliInvocation extends Context.Service<CliInvocation, {
  readonly argv: readonly string[];
  readonly exitCode: Effect.Effect<number>;
  readonly setExitCode: (value: number) => Effect.Effect<void>;
}>()('concord/cli/CliInvocation') {
  static layer(argv: readonly string[]) {
    return Layer.effect(CliInvocation, Effect.gen(function*() {
      const exitCode = yield* Ref.make(0);
      return CliInvocation.of({
        argv: Object.freeze([...argv]),
        exitCode: Ref.get(exitCode),
        setExitCode: value => Ref.set(exitCode, value),
      });
    }));
  }
}

export const setExitCode = (value: number) => Effect.flatMap(CliInvocation, invocation => invocation.setExitCode(value));

export const writeStdout = Effect.fn('CliInvocation.writeStdout')(function*(text: string) {
  const stdio = yield* Stdio.Stdio;
  yield* Stream.run(Stream.succeed(Buffer.from(text, 'utf8')), stdio.stdout({ endOnDone: false }));
});

export const writeStderr = Effect.fn('CliInvocation.writeStderr')(function*(text: string) {
  const stdio = yield* Stdio.Stdio;
  yield* Stream.run(Stream.succeed(Buffer.from(text, 'utf8')), stdio.stderr({ endOnDone: false }));
});
