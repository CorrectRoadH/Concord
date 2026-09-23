import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Effect, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { HAWDB_ABI, HAWDB_REVISION, HAWDB_TARGETS, decodeNativeArtifact, hawdbTarget, type NativeArtifact } from '../src/hawdb-native-contract.js';

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
      for (const name of files) cpSync(join(packageDir, name), join(licenseDir, name));
    }
  }
  writeFileSync(join(dest, 'THIRD-PARTY-NOTICES.txt'), `${lines.join('\n')}\n`);
}
const ArgsSchema = Schema.Struct({ output: Schema.String, prebuilt: Schema.optional(Schema.String), requirePortable: Schema.Boolean, testHooks: Schema.Boolean });
function parseArgs(argv: readonly string[]): Schema.Schema.Type<typeof ArgsSchema> {
  const result: { output: string; prebuilt?: string; requirePortable: boolean; testHooks: boolean } = { output: 'dist/native', requirePortable: false, testHooks: false };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === '--output' && argv[i + 1]) result.output = argv[++i]!;
    else if (value === '--prebuilt' && argv[i + 1]) result.prebuilt = argv[++i]!;
    else if (value === '--require-portable') result.requirePortable = true;
    else if (value === '--test-hooks') result.testHooks = true;
    else throw new Error(`unknown or incomplete native build argument: ${value}`);
  }
  return Schema.decodeUnknownSync(ArgsSchema, { onExcessProperty: 'error' })(result);
}
function validateArtifact(folder: string, target: string, requirePortable: boolean): NativeArtifact {
  const artifact = decodeNativeArtifact(JSON.parse(readFileSync(join(folder, 'artifact.json'), 'utf8')));
  if (artifact.target !== target || artifact.abi !== HAWDB_ABI || artifact.revision !== HAWDB_REVISION) throw new Error(`native identity mismatch: ${folder}`);
  if (artifact.sourceDigest !== digestSources() || artifact.cargoLockDigest !== shaFile(join(crate, 'Cargo.lock'))) throw new Error(`native source/lock mismatch: ${folder}`);
  if (artifact.binarySha256 !== shaFile(join(folder, 'hawdb.node'))) throw new Error(`native binary digest mismatch: ${folder}`);
  if (artifact.noticesSha256 !== shaFile(join(folder, 'THIRD-PARTY-NOTICES.txt'))) throw new Error(`native dependency notices mismatch: ${folder}`);
  if (target === 'darwin-arm64' && artifact.deploymentTarget !== '14.0') throw new Error(`native deployment target mismatch: ${folder}`);
  if (requirePortable && artifact.testHooks) throw new Error(`test-hook native artifact cannot ship: ${folder}`);
  if (requirePortable && !artifact.portable) throw new Error(`native artifact is not portable: ${folder}`);
  return artifact;
}
function portableLinkage(binary: string, target: string): boolean {
  if (target === 'darwin-arm64') {
    try {
      const loadCommands = execFileSync('otool', ['-l', binary], { encoding: 'utf8' });
      return process.env.MACOSX_DEPLOYMENT_TARGET === '14.0' && /\bminos\s+14\.0(?:\D|$)/u.test(loadCommands);
    } catch { return false; }
  }
  try {
    const dependencies = execFileSync('ldd', [binary], { encoding: 'utf8' });
    const glibc = execFileSync('getconf', ['GNU_LIBC_VERSION'], { encoding: 'utf8' }).trim().match(/^glibc (\d+)\.(\d+)$/u);
    return !dependencies.includes('/nix/store/') && !dependencies.includes('not found') && !!glibc && Number(glibc[1]) === 2 && Number(glibc[2]) <= 39;
  } catch { return false; }
}
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
  if (target === 'darwin-arm64' && process.env.MACOSX_DEPLOYMENT_TARGET !== '14.0') return yield* Effect.fail(new Error('MACOSX_DEPLOYMENT_TARGET=14.0 required'));
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
      ...(target === 'darwin-arm64' ? { deploymentTarget: '14.0' } : {}),
    };
    writeFileSync(join(dest, 'artifact.json'), `${JSON.stringify(artifact, null, 2)}\n`);
    validateArtifact(dest, target, args.requirePortable);
  });
});
program.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
