import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { Effect, Schema } from 'effect';
import { NodeRuntime } from '@effect/platform-node';

class ViewMeasurementFailed extends Schema.TaggedError<ViewMeasurementFailed>()('ViewMeasurementFailed', {
  stage: Schema.String, message: Schema.String, cause: Schema.Defect(),
}) {}

const failed = (stage: string, cause: unknown) => cause instanceof ViewMeasurementFailed ? cause
  : new ViewMeasurementFailed({ stage, message: String(cause), cause });
const io = <A>(stage: string, run: () => A) => Effect.try({ try: run, catch: cause => failed(stage, cause) });
const strict = { onExcessProperty: 'error' } as const;
const Text = Schema.String.check(Schema.isMinLength(1));
const Arguments = Schema.Struct({ artifact: Text, root: Text, output: Text,
  samples: Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 })),
});
const Ready = Schema.Struct({ operation: Schema.Literal('view'), root: Text, host: Text, port: Schema.Int,
  address: Text, local: Schema.Array(Text), network: Schema.Array(Text),
});
const ProjectionError = Schema.Struct({ failedAt: Text, code: Text, message: Schema.String });
const ProjectionStatus = Schema.Struct({
  status: Schema.Literals(['ready', 'refresh-failed', 'blocked']), current: Schema.Literal(false),
  refreshOwner: Schema.Literals(['active', 'none']), builtAt: Text, builtFrom: Text, builtUntil: Text,
  consistent: Schema.Boolean, complete: Schema.Boolean, changedPaths: Schema.Array(Schema.String), unknownRelations: Schema.Boolean,
  lastError: Schema.optionalKey(ProjectionError),
  lastAttempt: Schema.optionalKey(Schema.Struct({ at: Text, complete: Schema.Boolean, changedPaths: Schema.Array(Schema.String) })),
});
const Workspace = Schema.Struct({ ok: Schema.Literal(true), value: Schema.Struct({
  snapshot: Schema.Record(Schema.String, Schema.Unknown), projection: ProjectionStatus,
}) });
// Only the large snapshot's contents are outside this measurement's contract.
const Snapshot = Schema.Struct({ root: Text });
const Response = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: Schema.Unknown }),
  Schema.Struct({ ok: Schema.Literal(false), error: Text, message: Schema.String, details: Schema.optionalKey(Schema.Unknown) }),
]);

function artifactDigest(artifact: string): string {
  const hash = createHash('sha256');
  const visit = (folder: string, prefix: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(folder, entry.name), name = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) visit(path, name);
      else if (entry.isFile() && /(?:\.js|\.node|artifact\.json)$/u.test(entry.name)) {
        hash.update(name); hash.update('\0'); hash.update(readFileSync(path)); hash.update('\0');
      }
    }
  };
  visit(join(artifact, 'dist'), 'dist');
  return hash.digest('hex');
}

const prepare = io('prepare fixture', () => {
  const [artifactArg, rootArg, outputArg, samplesArg = '7'] = process.argv.slice(2);
  const args = Schema.decodeUnknownSync(Arguments, strict)({ artifact: artifactArg, root: rootArg, output: outputArg, samples: samplesArg });
  const artifact = realpathSync(resolve(args.artifact));
  const create = !existsSync(resolve(args.root));
  if (create) mkdirSync(resolve(args.root), { recursive: true });
  const root = realpathSync(resolve(args.root));
  const git = (...argv: string[]) => execFileSync('git', ['-C', root, ...argv], { encoding: 'utf8', timeout: 120_000 });
  if (create) {
    git('init', '-q');
    const cli = (...argv: string[]) => {
      execFileSync(process.execPath, [join(artifact, 'dist/entry.js'), '--root', root, '--json', ...argv], { encoding: 'utf8', timeout: 120_000 });
    };
    cli('init', '--test-root', 'test', '--source-root', 'src', '--yes');
    cli('feature', 'create', 'measured', '--title', 'Measured', '--no-pages');
    mkdirSync(join(root, 'src'), { recursive: true });
    for (let index = 0; index < 1112; index++) writeFileSync(join(root, `src/file-${index}.ts`), `// @concord-file\n// @concord-implements docs/feature/measured/README.md\nexport const value${index} = ${index};\n`);
    for (let index = 0; index < 110; index++) writeFileSync(join(root, `docs/feature/measured/page-${index}.md`), `# Page ${index}\n\nMeasured content.\n`);
    git('add', '.');
    git('-c', 'user.name=Concord measurement', '-c', 'user.email=measurement@example.invalid', 'commit', '-qm', 'Frozen request fixture');
  }
  if (git('status', '--porcelain').trim()) throw new Error('Measurement requires a frozen, clean consumer');
  return { artifact, root, output: resolve(args.output), sampleCount: args.samples, commit: git('rev-parse', 'HEAD').trim(), git };
});

const startServer = (artifact: string, root: string) => io('start view', () => {
  const server = spawn(process.execPath, [join(artifact, 'dist/entry.js'), '--root', root, '--json', 'view', '--host', '127.0.0.1', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let closed = false;
  let spawnError: Error | undefined;
  const exited = new Promise<void>(accept => server.once('close', () => { closed = true; accept(); }));
  server.once('error', cause => { spawnError = cause; });
  let stderr = '';
  server.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-128 * 1024); });
  let stdout = '';
  let readyAt: number | undefined;
  server.stdout.on('data', (chunk: Buffer) => {
    stdout = (stdout + chunk.toString()).slice(-128 * 1024);
    if (readyAt === undefined && stdout.includes('\n')) readyAt = performance.now();
  });
  return { server, exited, isClosed: () => closed, error: () => spawnError, stderr: () => stderr, stdout: () => stdout, readyAt: () => readyAt };
});
type ViewServer = Effect.Success<ReturnType<typeof startServer>>;

const stopServer = (handle: ViewServer) => Effect.tryPromise({ try: async () => {
  if (handle.isClosed()) return;
  handle.server.kill('SIGTERM');
  const timer = setTimeout(() => handle.server.kill('SIGKILL'), 10_000);
  try { await handle.exited; } finally { clearTimeout(timer); }
}, catch: cause => failed('stop view', cause) }).pipe(Effect.orDie);

/** Separate HTTP client and server processes: client timings include event-loop admission delay. */
const measure = Effect.gen(function*() {
  const { artifact, root, output, sampleCount, commit, git } = yield* prepare;
  const handle = yield* Effect.acquireRelease(startServer(artifact, root), stopServer);
  yield* Effect.tryPromise({ try: async signal => {
    const startup = performance.now();
    while (handle.readyAt() === undefined) {
      if (handle.error() || handle.isClosed()) throw new Error(`View exited before ready: ${handle.error() ?? handle.server.exitCode}; ${handle.stderr()}`);
      if (performance.now() - startup >= 30_000) throw new Error('View startup timed out');
      await delay(10, undefined, { signal });
    }
    const readyAt = handle.readyAt()!;
    const address = Schema.decodeUnknownSync(Schema.fromJsonString(Ready), strict)(handle.stdout().split('\n')[0]!).address;
    const request = async (route: string, body?: unknown, timeoutMs = 60_000) => {
      const started = performance.now();
      const response = await fetch(new URL(route, address), { signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]), ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
      const payload: unknown = await response.json();
      const decoded = Schema.decodeUnknownSync(Response, strict)(payload);
      return { ms: Math.round((performance.now() - started) * 100) / 100, status: response.status, success: response.ok, payload, decoded };
    };
    const decodeWorkspace = (payload: unknown) => {
      const state = Schema.decodeUnknownSync(Workspace, strict)(payload).value;
      Schema.decodeUnknownSync(Snapshot, { onExcessProperty: 'ignore' })(state.snapshot);
      return state;
    };
    const successfulRequest = async (route: string, body?: unknown) => {
      const response = await request(route, body);
      if (!response.success || !response.decoded.ok) throw new Error(`Request failed: ${route}; ${JSON.stringify(response.payload)}`);
      if (route === 'api/workspace') decodeWorkspace(response.payload);
      return response;
    };
    const deadline = readyAt + 120_000;
    let state: typeof Workspace.Type['value'] | undefined;
    let lastResponse: unknown = null;
    try {
      while (performance.now() < deadline) {
        const response = await request('api/workspace', undefined, Math.max(1, Math.ceil(deadline - performance.now())));
        lastResponse = { status: response.status, payload: response.payload };
        if (response.success && response.decoded.ok) {
          state = decodeWorkspace(response.payload);
          break;
        }
        if (response.decoded.ok || response.decoded.error !== 'WorkspaceProjectionPending'
          && !(response.decoded.error === 'WorkspaceProjectionUnavailable'
            && Schema.is(Schema.Struct({ reason: Schema.Literal('HawdbBusy') }))(response.decoded.details))) {
          throw new Error(`Workspace failed: ${JSON.stringify(lastResponse)}`);
        }
        await delay(Math.min(250, Math.max(0, deadline - performance.now())), undefined, { signal });
      }
    } catch (cause) {
      if (performance.now() >= deadline) throw new Error(`Workspace snapshot timed out after 120000ms; last response: ${JSON.stringify(lastResponse)}`, { cause });
      throw cause;
    }
    if (!state || performance.now() >= deadline) throw new Error(`Workspace snapshot timed out after 120000ms; last response: ${JSON.stringify(lastResponse)}`);
    const firstRequestMs = Math.round((performance.now() - readyAt) * 100) / 100;
    const path = 'docs/feature/measured/page-0.md';
    const body = readFileSync(join(root, path), 'utf8');
    const expectedDigest = `sha256:${createHash('sha256').update(body).digest('hex')}`;
    const samples = [];
    for (let index = 0; index < sampleCount; index++) {
      const [workspace, [jobs, file, action]] = await Promise.all([
        successfulRequest('api/workspace'),
        (async () => {
          await delay(10, undefined, { signal });
          return Promise.all([
            successfulRequest('api/jobs'), successfulRequest(`api/file?path=${encodeURIComponent(path)}`),
            successfulRequest('api/action', { action: 'document.set', path, body, expectedDigest }),
          ]);
        })(),
      ]);
      samples.push({ workspace: workspace.ms, jobs: jobs.ms, file: file.ms, action: action.ms });
    }
    if (readFileSync(join(root, path), 'utf8') !== body || git('status', '--porcelain').trim() || git('rev-parse', 'HEAD').trim() !== commit) {
      throw new Error('Measurement changed the frozen consumer');
    }
    const result = { artifact, artifactDigest: artifactDigest(artifact), platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, root, node: process.version, commit, scale: { sourceFiles: 1112, supportingPages: 110 }, firstRequestMs, projection: { hasSnapshot: true, ...state.projection }, samples };
    writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }, catch: cause => failed('measure requests', cause) }).pipe(
    Effect.ensuring(io('write server diagnostics', () => writeFileSync(`${output}.stderr`, handle.stderr())).pipe(Effect.orDie)),
  );
}).pipe(Effect.scoped);

measure.pipe(NodeRuntime.runMain);
