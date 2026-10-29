import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Effect, FileSystem, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { HAWDB_ABI, HAWDB_REVISION, HAWDB_TARGETS, HAWDB_MACOS_DEPLOYMENT_TARGET, decodeNativeArtifact, hawdbTarget, type NativeArtifact } from '../src/hawdb-native-contract.js';

const root = resolve(import.meta.dirname, '..');
const crate = join(root, 'native/hawdb');
const sources = ['native/hawdb/Cargo.toml', 'native/hawdb/build.rs', 'native/hawdb/rust-toolchain.toml', 'native/hawdb/src/lib.rs', 'native/hawdb/UPSTREAM.txt', 'native/hawdb/HAWDB-LICENSE.txt', 'src/hawdb-native.ts', 'src/hawdb-native-contract.ts', 'scripts/build-native.ts'];
const hash = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const digestSources = (): string => hash(sources.map(name => `${name}\0${hash(readFileSync(join(root, name)))}\n`).join(''));
const shaFile = (path: string): string => hash(readFileSync(path));
const CargoMetadataSchema = Schema.Struct({ packages: Schema.Array(Schema.Struct({
  name: Schema.String, version: Schema.String, license: Schema.NullOr(Schema.String),
  manifest_path: Schema.String, source: Schema.NullOr(Schema.String),
})) });
const LicenseDigests = Schema.Array(Schema.Struct({ path: Schema.String, sha256: Schema.String }));
const licenseMarker = 'Concord license file digests:';
function licenseDigests(folder: string): { path: string; sha256: string }[] {
  const files = ['HAWDB-LICENSE.txt', 'UPSTREAM.txt'];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(join(folder, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`native license must be a regular file: ${path}`);
    }
  };
  visit('licenses');
  return files.sort().map(path => ({ path, sha256: shaFile(join(folder, path)) }));
}
function dependencyNotices(dest: string): void {
  const metadata = Schema.decodeUnknownSync(CargoMetadataSchema, { onExcessProperty: 'ignore' })(JSON.parse(execFileSync('cargo', [
    '+1.97.1', 'metadata', '--locked', '--format-version=1', '--manifest-path', join(crate, 'Cargo.toml'),
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })));
  const lines = ['Pinned Cargo dependency licenses; see licenses/ for distributed license and notice files.', ''];
  for (const pkg of [...metadata.packages].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))) {
    if (pkg.source === null || pkg.source.startsWith('git+')) continue; // HawDB and its crates use HAWDB-LICENSE.txt.
    if (!pkg.license) throw new Error(`dependency has no license declaration: ${pkg.name}@${pkg.version}`);
    const id = `${pkg.name}-${pkg.version}`;
    lines.push(`${id} | ${pkg.license} | ${pkg.source}`);
    const packageDir = resolve(pkg.manifest_path, '..');
    const files = readdirSync(packageDir).filter(name => /^(?:LICENSE|LICENCE|COPYING|NOTICE)(?:[._-].*)?$/iu.test(name));
    if (files.length > 0) {
      const licenseDir = join(dest, 'licenses', id);
      mkdirSync(licenseDir, { recursive: true });
      for (const name of files) cpSync(join(packageDir, name), join(licenseDir, name), { dereference: true });
    }
  }
  lines.push('', licenseMarker, JSON.stringify(licenseDigests(dest)));
  writeFileSync(join(dest, 'THIRD-PARTY-NOTICES.txt'), `${lines.join('\n')}\n`);
}
const ArgsSchema = Schema.Struct({ output: Schema.String, prebuilt: Schema.optional(Schema.String), requirePortable: Schema.Boolean, testHooks: Schema.Boolean, reuse: Schema.Boolean });
function parseArgs(argv: readonly string[]): Schema.Schema.Type<typeof ArgsSchema> {
  const result: { output: string; prebuilt?: string; requirePortable: boolean; testHooks: boolean; reuse: boolean } = { output: 'dist/native', requirePortable: false, testHooks: false, reuse: false };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === '--output' && argv[i + 1]) result.output = argv[++i]!;
    else if (value === '--prebuilt' && argv[i + 1]) result.prebuilt = argv[++i]!;
    else if (value === '--require-portable') result.requirePortable = true;
    else if (value === '--reuse') result.reuse = true;
    else if (value === '--test-hooks') result.testHooks = true;
    else throw new Error(`unknown or incomplete native build argument: ${value}`);
  }
  return Schema.decodeUnknownSync(ArgsSchema, { onExcessProperty: 'error' })(result);
}
function validateArtifact(folder: string, target: string, requirePortable: boolean): NativeArtifact {
  for (const name of ['artifact.json', 'hawdb.node', 'THIRD-PARTY-NOTICES.txt', 'HAWDB-LICENSE.txt', 'UPSTREAM.txt']) {
    if (!lstatSync(join(folder, name)).isFile()) throw new Error(`native artifact must be a regular file: ${name}`);
  }
  const artifact = decodeNativeArtifact(JSON.parse(readFileSync(join(folder, 'artifact.json'), 'utf8')));
  if (artifact.target !== target || artifact.abi !== HAWDB_ABI || artifact.revision !== HAWDB_REVISION) throw new Error(`native identity mismatch: ${folder}`);
  if (artifact.sourceDigest !== digestSources() || artifact.cargoLockDigest !== shaFile(join(crate, 'Cargo.lock'))) throw new Error(`native source/lock mismatch: ${folder}`);
  if (artifact.binarySha256 !== shaFile(join(folder, 'hawdb.node'))) throw new Error(`native binary digest mismatch: ${folder}`);
  if (artifact.noticesSha256 !== shaFile(join(folder, 'THIRD-PARTY-NOTICES.txt'))) throw new Error(`native dependency notices mismatch: ${folder}`);
  const noticeLines = readFileSync(join(folder, 'THIRD-PARTY-NOTICES.txt'), 'utf8').trimEnd().split('\n');
  if (noticeLines.at(-2) !== licenseMarker) throw new Error(`native license digests missing: ${folder}`);
  const expectedLicenses = Schema.decodeUnknownSync(Schema.fromJsonString(LicenseDigests), { onExcessProperty: 'error' })(noticeLines.at(-1));
  if (JSON.stringify(expectedLicenses) !== JSON.stringify(licenseDigests(folder))) throw new Error(`native license digest mismatch: ${folder}`);
  for (const name of ['HAWDB-LICENSE.txt', 'UPSTREAM.txt']) {
    if (shaFile(join(folder, name)) !== shaFile(join(crate, name))) throw new Error(`native source notice mismatch: ${name}`);
  }
  if (target === 'darwin-arm64' && artifact.deploymentTarget !== HAWDB_MACOS_DEPLOYMENT_TARGET) throw new Error(`native deployment target mismatch: ${folder}`);
  if (requirePortable && artifact.testHooks) throw new Error(`test-hook native artifact cannot ship: ${folder}`);
  if (requirePortable && !artifact.portable) throw new Error(`native artifact is not portable: ${folder}`);
  return artifact;
}
function portableLinkage(binary: string, target: string): boolean {
  if (target === 'darwin-arm64') {
    try {
      const loadCommands = execFileSync('otool', ['-l', binary], { encoding: 'utf8' });
      const identity = execFileSync('otool', ['-D', binary], { encoding: 'utf8' }).trim().split('\n').at(-1)?.trim();
      const minimum = /\bminos\s+(\d+\.\d+)(?:\s|$)/u.exec(loadCommands)?.[1];
      return process.env.MACOSX_DEPLOYMENT_TARGET === HAWDB_MACOS_DEPLOYMENT_TARGET && minimum === HAWDB_MACOS_DEPLOYMENT_TARGET && identity === '@rpath/hawdb.node';
    } catch { return false; }
  }
  try {
    const dependencies = execFileSync('ldd', [binary], { encoding: 'utf8' });
    const glibc = execFileSync('getconf', ['GNU_LIBC_VERSION'], { encoding: 'utf8' }).trim().match(/^glibc (\d+)\.(\d+)$/u);
    return !dependencies.includes('/nix/store/') && !dependencies.includes('not found') && !!glibc && Number(glibc[1]) === 2 && Number(glibc[2]) <= 39;
  } catch { return false; }
}
class NativeReuseFailed extends Schema.TaggedError<NativeReuseFailed>()('NativeReuseFailed', { detail: Schema.String }) {}
const reuseFailure = (cause: unknown) => new NativeReuseFailed({ detail: cause instanceof Error ? cause.message : String(cause) });
const reason = (source: string, cause: unknown): void => {
  const detail = cause instanceof NativeReuseFailed ? cause.detail : String(cause);
  console.error(`# Native ${source}: ${detail.replace(/\s+/gu, ' ')}; falling back`);
};

function copyArtifact(input: string, output: string, target: string): void {
  validateArtifact(join(input, target), target, false);
  const artifact = decodeNativeArtifact(JSON.parse(readFileSync(join(input, target, 'artifact.json'), 'utf8')));
  if (artifact.testHooks) throw new Error('test-hook native artifact cannot be reused');
  const dest = join(output, target);
  mkdirSync(dest, { recursive: true });
  cpSync(join(input, target), dest, { recursive: true, force: true });
  validateArtifact(dest, target, false);
}

function cacheArtifact(input: string, cache: string, target: string): void {
  mkdirSync(cache, { recursive: true });
  const staging = mkdtempSync(join(cache, '.publish-'));
  try {
    copyArtifact(input, staging, target);
    const dest = join(cache, target);
    try {
      validateArtifact(dest, target, false);
      const existing = decodeNativeArtifact(JSON.parse(readFileSync(join(dest, 'artifact.json'), 'utf8')));
      if (existing.testHooks) throw new Error('test-hook cache');
      return;
    } catch { rmSync(dest, { recursive: true, force: true }); }
    renameSync(join(staging, target), dest);
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

const reuseNative = Effect.fn('native.reuse')(function* (cache: string, output: string, target: string) {
  const local = yield* Effect.try({ try: () => copyArtifact(cache, output, target), catch: reuseFailure }).pipe(
    Effect.match({ onFailure: cause => { reason('cache', cause); return false; }, onSuccess: () => true }),
  );
  if (local) { yield* Effect.sync(() => console.error(`# Native cache hit: ${join(cache, target)}`)); return true; }
  if (process.env.CONCORD_NATIVE_OFFLINE === '1') {
    yield* Effect.sync(() => console.error('# Native download skipped: CONCORD_NATIVE_OFFLINE=1; falling back to cargo'));
    return false;
  }
  return yield* Effect.scoped(Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem;
    const scratch = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-native-download-' });
    const base = process.env.CONCORD_NATIVE_RELEASE_BASE_URL ?? 'https://github.com/CorrectRoadH/Concord/releases/download';
    const url = `${base.replace(/\/$/u, '')}/native-${digestSources().slice(0, 16)}/concord-native-${target}.tar.gz`;
    const bytes = yield* Effect.tryPromise({ try: async signal => {
      const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (!response.body) throw new Error('empty native response');
      const reader = response.body.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 128 * 1024 * 1024) throw new Error('native download exceeds 128 MiB');
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel(); }
      return Buffer.concat(chunks);
    }, catch: reuseFailure });
    const archive = join(scratch, 'native.tar.gz');
    yield* fs.writeFile(archive, bytes);
    yield* Effect.try({ try: () => {
      const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim().split('\n');
      if (!names.length || names.some(name => !name.startsWith(`${target}/`) || name.includes('\\') || name.split('/').some(part => part === '..' || part === '.'))) throw new Error('unsafe native archive paths');
      const entries = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim().split('\n');
      if (entries.some(entry => !/^[-d]/u.test(entry))) throw new Error('native archive contains links or special files');
      execFileSync('tar', ['-xzf', archive, '-C', scratch, '--no-same-owner', '--no-same-permissions']);
      copyArtifact(scratch, output, target);
      cacheArtifact(scratch, cache, target);
      console.error(`# Native release hit: native-${digestSources().slice(0, 16)} / ${target}`);
    }, catch: reuseFailure });
    return true;
  })).pipe(Effect.catch(cause => Effect.sync(() => { reason('download', cause); return false; })));
});

const program = Effect.gen(function*() {
  const args = yield* Effect.sync(() => parseArgs(process.argv.slice(2)));
  const output = resolve(root, args.output);
  if (args.requirePortable && args.testHooks) return yield* Effect.fail(new Error('test hooks cannot be portable'));
  if (args.prebuilt) {
    const input = resolve(root, args.prebuilt);
    const targets = args.requirePortable ? HAWDB_TARGETS : readdirSync(input).filter(value => (HAWDB_TARGETS as readonly string[]).includes(value));
    if (targets.length === 0) return yield* Effect.fail(new Error('no native artifacts supplied'));
    const verified = yield* Effect.sync(() => targets.map(target => validateArtifact(join(input, target), target, args.requirePortable)));
    if (args.requirePortable && verified.length !== HAWDB_TARGETS.length) return yield* Effect.fail(new Error('both release targets required'));
    yield* Effect.sync(() => {
      for (const target of targets) {
        const from = join(input, target);
        const to = join(output, target);
        if (from !== to) { mkdirSync(to, { recursive: true }); cpSync(from, to, { recursive: true, force: true }); }
      }
    });
    return;
  }
  const target = yield* Effect.sync(hawdbTarget);
  const cache = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'concord/native', `${digestSources()}-${shaFile(join(crate, 'Cargo.lock'))}`);
  if (args.reuse && !args.testHooks && !args.requirePortable && (yield* reuseNative(cache, output, target))) return;
  if (target === 'darwin-arm64' && process.env.MACOSX_DEPLOYMENT_TARGET !== HAWDB_MACOS_DEPLOYMENT_TARGET) return yield* Effect.fail(new Error(`MACOSX_DEPLOYMENT_TARGET=${HAWDB_MACOS_DEPLOYMENT_TARGET} required`));
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const exitCode = yield* spawner.exitCode(ChildProcess.make('cargo', ['+1.97.1', 'build', '--release', '--locked', '--manifest-path', join(crate, 'Cargo.toml'), ...(args.testHooks ? ['--features', 'test-hooks'] : [])], { stdout: 'inherit', stderr: 'inherit' }));
  if (exitCode !== 0) return yield* Effect.fail(new Error(`cargo native build failed: ${exitCode}`));
  yield* Effect.sync(() => {
    const library = join(process.env.CARGO_TARGET_DIR ?? join(crate, 'target'), 'release', target === 'darwin-arm64' ? 'libconcord_hawdb_native.dylib' : 'libconcord_hawdb_native.so');
    const dest = join(output, target);
    mkdirSync(dest, { recursive: true });
    const binary = join(dest, 'hawdb.node');
    cpSync(library, binary);
    cpSync(join(crate, 'HAWDB-LICENSE.txt'), join(dest, 'HAWDB-LICENSE.txt'));
    cpSync(join(crate, 'UPSTREAM.txt'), join(dest, 'UPSTREAM.txt'));
    dependencyNotices(dest);
    const artifact: NativeArtifact = {
      target, abi: HAWDB_ABI, revision: HAWDB_REVISION,
      sourceDigest: digestSources(), cargoLockDigest: shaFile(join(crate, 'Cargo.lock')),
      binarySha256: shaFile(binary), noticesSha256: shaFile(join(dest, 'THIRD-PARTY-NOTICES.txt')), portable: !args.testHooks && portableLinkage(binary, target), testHooks: args.testHooks,
      ...(target === 'darwin-arm64' ? { deploymentTarget: HAWDB_MACOS_DEPLOYMENT_TARGET } : {}),
    };
    writeFileSync(join(dest, 'artifact.json'), `${JSON.stringify(artifact, null, 2)}\n`);
    validateArtifact(dest, target, args.requirePortable);
    if (args.reuse && !args.testHooks) {
      try { cacheArtifact(output, cache, target); }
      catch (cause) { console.error(`# Native cache write failed: ${String(cause)}`); }
    }
  });
});
program.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
