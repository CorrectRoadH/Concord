// @concord-file
// @concord-implements docs/engineering/testing/architecture.md#进程内-cli
import { Console as NodeConsole } from 'node:console';
import { Writable } from 'node:stream';
import { type Cause, ConfigProvider, Console, Effect, Layer, Queue, Sink, Stdio, Stream, Terminal } from 'effect';
import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { fullProgram } from '../../src/entry/cli/entry-full.ts';
import { cliPlatformLayer } from '../../src/entry/cli/main.ts';

export interface CliInput {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdin?: string | Uint8Array;
  readonly signal?: AbortSignal;
}
export interface CliResult { readonly stdout: string; readonly stderr: string; readonly exitCode: number }

/** Each invocation owns its byte streams, context and scope; the host is never rebound. */
export async function runCli(input: CliInput): Promise<CliResult> {
  const runtime = makeRuntimeEnvironment(input.cwd, input.env);
  const argv = Object.freeze([...input.argv]);
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  const writable = (output: Buffer[]) => new Writable({ write(chunk: Buffer, _encoding, done) { output.push(Buffer.from(chunk)); done(); } });
  const console: Console.Console = new NodeConsole({ stdout: writable(stdout), stderr: writable(stderr), colorMode: false });
  const sink = (output: Buffer[]) => Sink.forEach((bytes: string | Uint8Array) => Effect.sync(() => { output.push(Buffer.from(bytes)); }));
  const stdio = Stdio.make({
    args: Effect.succeed(argv),
    stdin: input.stdin === undefined ? Stream.empty : Stream.succeed(Buffer.from(input.stdin)),
    stdout: () => sink(stdout), stderr: () => sink(stderr),
  });
  const terminal = Terminal.make({
    size: Effect.acquireRelease(Queue.unbounded<Terminal.Size, Cause.Done>().pipe(Effect.tap(queue => Queue.offer(queue, { columns: 80, rows: 24 }))), queue => Queue.end(queue)), columns: Effect.succeed(80), rows: Effect.succeed(24),
    readInput: Effect.die('Captured non-TTY CLI cannot request interactive terminal input'),
    readLine: Effect.fail(new Terminal.QuitError()),
    display: text => Effect.sync(() => { stdout.push(Buffer.from(text, 'utf8')); }),
  });
  const platform = Layer.mergeAll(
    cliPlatformLayer, RuntimeEnvironment.layer(runtime),
    Layer.succeed(Stdio.Stdio, stdio), Layer.succeed(Console.Console, console), Layer.succeed(Terminal.Terminal, terminal),
    ConfigProvider.layer(ConfigProvider.fromEnvRecord(runtime.env)),
  );
  const exitCode = await Effect.runPromise(fullProgram(argv).pipe(Effect.provide(platform)), { signal: input.signal });
  return { stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exitCode };
}
