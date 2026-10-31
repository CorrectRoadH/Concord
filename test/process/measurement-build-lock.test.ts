import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { tmpdir } from '../support/temporary.js';

test('measurement holds the build lease across candidate construction and samples while concurrent vp build waits', { timeout: 45_000 }, context => Effect.runPromise(Effect.tryPromise(async () => {
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const address = reservation.address(); assert.ok(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((accept, reject) => reservation.close(cause => cause ? reject(cause) : accept()));
  const root = mkdtempSync(join(tmpdir(), 'concord-measurement-lock-'));
  const builds = join(root, 'builds');
  const children: { child: ReturnType<typeof spawn>; closed: Promise<unknown[]>; diagnostics: () => string }[] = [];
  const stop = () => { for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); };
  context.signal.addEventListener('abort', stop, { once: true });
  const launch = (argv: string[], env: NodeJS.ProcessEnv) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd: root, env, stdio: 'pipe' });
    const closed = once(child, 'close'); let stdout = '', stderr = '';
    child.stdout!.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    const output = (stream: typeof child.stdout, read: () => string, pattern: RegExp) => Effect.runPromise(Effect.tryPromise(async () => {
      while (!pattern.test(read())) await Promise.race([once(stream!, 'data'), closed.then(() => { throw new Error(`Fixture exited before ${pattern}: ${stdout}\n${stderr}`); })]);
      return read();
    }));
    children.push({ child, closed, diagnostics: () => stdout + stderr });
    return { child, closed, stdout: () => stdout, stderr: () => stderr, output };
  };
  try {
    mkdirSync(join(root, 'runs'));
    const packageManager = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ packageManager: Schema.String })))(readFileSync(resolve('package.json'), 'utf8')).packageManager;
    writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module', packageManager }));
    // Keep dependency verification while preventing installation through the shared toolchain link.
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'verifyDepsBeforeRun: warn\n');
    symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
    writeFileSync(join(root, 'index.html'), '<main>measurement lock</main>');
    writeFileSync(join(root, 'vite.config.ts'), `import { defineConfig } from 'vite-plus';\nimport { appendFileSync } from 'node:fs';\nimport { buildLockPlugin } from ${JSON.stringify(resolve('scripts/build-lock-plugin.ts'))};\nexport default defineConfig({ plugins: [buildLockPlugin(${port}), { name: 'observe-build', buildStart() { appendFileSync(${JSON.stringify(builds)}, 'built\\n'); } }], build: { outDir: 'dist', emptyOutDir: true } });\n`);
    const env = { ...process.env };
    const owner = launch([process.execPath, '--import', import.meta.resolve('tsx'), resolve('test/fixtures/measurement-build.ts'), root, String(port)], env);
    const ready = await owner.output(owner.child.stdout, owner.stdout, /"sampling":true/u);
    const sampling = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ sampling: Schema.Literal(true), pid: Schema.Int })))(ready.trim());
    assert.equal(sampling.pid, owner.child.pid);
    assert.equal(readFileSync(builds, 'utf8'), 'built\n', 'the inherited build must finish before sampling');
    assert.ok(existsSync(join(root, 'dist/index.html')));
    const contender = launch(['pnpm', 'exec', 'vp', 'build'], { ...env, CONCORD_BUILD_LOCK: '' });
    const waiting = await contender.output(contender.child.stderr, contender.stderr, /Build lock: waiting/u);
    assert.match(waiting, new RegExp(`pid=${sampling.pid}; started=\\d{4}-`));
    assert.equal(readFileSync(builds, 'utf8'), 'built\n', 'a concurrent build cannot start while sampling owns the lease');
    owner.child.stdin!.end();
    assert.equal((await owner.closed)[0], 0, owner.stderr());
    assert.equal((await contender.closed)[0], 0, contender.stderr());
    assert.equal(readFileSync(builds, 'utf8'), 'built\nbuilt\n');
  } finally {
    context.signal.removeEventListener('abort', stop);
    stop();
    await Promise.all(children.map(child => child.closed));
    rmSync(root, { recursive: true, force: true });
  }
})));
