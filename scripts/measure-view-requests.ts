import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { Effect, Schema } from 'effect';
import { NodeRuntime } from '@effect/platform-node';
import { LocalRepository, initialize } from '../src/storage.js';
import { createDocument } from '../src/documents.js';

const Ready = Schema.Struct({ address: Schema.String });
const Workspace = Schema.Struct({ ok: Schema.Boolean, value: Schema.Struct({
  complete: Schema.Boolean, findings: Schema.Array(Schema.Struct({ code: Schema.String })),
  cache: Schema.Struct({ status: Schema.String }),
}) });
const Response = Schema.Struct({ ok: Schema.Boolean });

/** Separate HTTP client and server processes: client timings include event-loop admission delay. */
const measure = Effect.tryPromise({ try: async () => {
  const [artifactArg, rootArg, outputArg, samplesArg = '7'] = process.argv.slice(2);
  if (!artifactArg || !rootArg || !outputArg) throw new Error('Usage: measure-view-requests.ts <artifact-directory> <isolated-consumer> <output.json> [samples=7]');
  const artifact = resolve(artifactArg), root = resolve(rootArg);
  const sampleCount = Number(samplesArg);
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 1 || sampleCount > 100) throw new Error('Sample count must be between 1 and 100');
  if (!existsSync(root)) {
    mkdirSync(root);
    execFileSync('git', ['init', '-q', root]);
    const repo = new LocalRepository(root, { initialize: true });
    try {
      initialize(repo, false, { testRoots: [], sourceRoots: ['src'] });
      createDocument(repo, 'feature', { id: 'measured', title: 'Measured', pages: [] });
    } finally { repo.close(); }
    mkdirSync(join(root, 'src'));
    for (let index = 0; index < 1112; index++) writeFileSync(join(root, `src/file-${index}.ts`), `// @concord-file\n// @concord-implements docs/feature/measured/README.md\nexport const value${index} = ${index};\n`);
    for (let index = 0; index < 110; index++) writeFileSync(join(root, `docs/feature/measured/page-${index}.md`), `# Page ${index}\n\nMeasured content.\n`);
    execFileSync('git', ['-C', root, 'add', '.']);
    execFileSync('git', ['-C', root, '-c', 'user.name=Concord measurement', '-c', 'user.email=measurement@example.invalid', 'commit', '-qm', 'Frozen request fixture']);
  }
  const server = spawn(process.execPath, [join(artifact, 'dist/entry.js'), '--root', root, '--json', 'view', '--host', '127.0.0.1', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(server, 'close');
  let stderr = '';
  server.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-128 * 1024); });
  try {
    const address = await new Promise<string>((accept, reject) => {
      let text = '';
      const timer = setTimeout(() => reject(new Error('View startup timed out')), 30_000);
      server.once('error', reject);
      server.once('exit', code => { clearTimeout(timer); reject(new Error(`View exited: ${code}; ${stderr}`)); });
      server.stdout.on('data', (chunk: Buffer) => {
        text += chunk.toString();
        if (!text.includes('\n')) return;
        clearTimeout(timer);
        try { accept(Schema.decodeUnknownSync(Schema.fromJsonString(Ready), { onExcessProperty: 'ignore' })(text.split('\n')[0]!).address); }
        catch (cause) { reject(cause); }
      });
    });
    const request = async (route: string, body?: unknown) => {
      const started = performance.now();
      const response = await fetch(new URL(route, address), { signal: AbortSignal.timeout(60_000), ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
      const payload: unknown = await response.json();
      if (!response.ok || !Schema.decodeUnknownSync(Response, { onExcessProperty: 'ignore' })(payload).ok) throw new Error(`Request failed: ${route}; ${JSON.stringify(payload)}`);
      return { ms: Math.round((performance.now() - started) * 100) / 100, status: response.status, payload };
    };
    const cold = await request('api/workspace');
    const state = Schema.decodeUnknownSync(Workspace, { onExcessProperty: 'ignore' })(cold.payload).value;
    const path = 'docs/feature/measured/page-0.md';
    const body = readFileSync(join(root, path), 'utf8');
    const expectedDigest = `sha256:${createHash('sha256').update(body).digest('hex')}`;
    const samples = [];
    for (let index = 0; index < sampleCount; index++) {
      const workspace = request('api/workspace');
      await delay(10);
      const [jobs, file, action] = await Promise.all([
        request('api/jobs'), request(`api/file?path=${encodeURIComponent(path)}`),
        request('api/action', { action: 'document.set', path, body, expectedDigest }),
      ]);
      samples.push({ workspace: (await workspace).ms, jobs: jobs.ms, file: file.ms, action: action.ms });
    }
    const result = { artifact, artifactDigest: createHash('sha256').update(readFileSync(join(artifact, 'dist/hawdb-native.js'))).digest('hex'), platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, root, node: process.version, commit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), scale: { sourceFiles: 1112, supportingPages: 110 }, coldMs: cold.ms, complete: state.complete, findings: state.findings.map(item => item.code), cache: state.cache.status, samples };
    writeFileSync(resolve(outputArg), `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(`${resolve(outputArg)}.stderr`, stderr);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally { server.kill('SIGTERM'); await exited; }
}, catch: cause => cause instanceof Error ? cause : new Error(String(cause)) });

measure.pipe(NodeRuntime.runMain);
