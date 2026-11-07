// @concord-file
// @concord-implements docs/feature/cross-platform-release/use-case/release-from-tag.md
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { createHash } from 'node:crypto';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { io, mustRun } from './perf/process.ts';

export class ReleaseArchiveInvalid extends Schema.TaggedError<ReleaseArchiveInvalid>()('ReleaseArchiveInvalid', { message: Schema.String }) {}
export class PackagedRuntimeUnavailable extends Schema.TaggedError<PackagedRuntimeUnavailable>()('PackagedRuntimeUnavailable', { message: Schema.String }) {}
const Target = Schema.Literals(['linux-x64', 'darwin-arm64']);
const Version = Schema.Union([Schema.Literal('dev'), Schema.String.check(Schema.isPattern(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u))]);
const SumLine = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}  [A-Za-z0-9][A-Za-z0-9._-]*$/u));
export const decodeReleaseChecksums = (text: string) => {
  const lines = Schema.decodeUnknownSync(Schema.Array(SumLine))(text.trimEnd().split('\n'));
  const entries = lines.map(line => [line.slice(66), line.slice(0, 64)] as const);
  if (new Set(entries.map(([name]) => name)).size !== entries.length || entries.some(([name]) => name === 'SHA256SUMS')) throw new ReleaseArchiveInvalid({ message: 'Duplicate or self-referencing checksum' });
  return new Map(entries);
};
const within = (root: string, path: string) => { const name = relative(root, path); return name === '' || name !== '..' && !name.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(name); };
const machoMagic = new Set(['feedface','cefaedfe','feedfacf','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca']);
const binaryMagic = Effect.fn('release.binaryMagic')(function*(path: string) {
  const fs = yield* FileSystem.FileSystem;
  const handle = yield* fs.open(path, { flag: 'r' });
  const head = new Uint8Array(4);
  yield* handle.read(head);
  return Buffer.from(head).toString('hex');
}, Effect.scoped);
const baseLibraries = new Set(['libc.so.6', 'libm.so.6', 'libdl.so.2', 'libpthread.so.0', 'librt.so.1', 'ld-linux-x86-64.so.2']);
export function validateElfInspection(file: string, root: string, inspection: string, bundled: ReadonlySet<string>) {
  const reject = (message: string): never => { throw new ReleaseArchiveInvalid({ message: `${file}: ${message}` }); };
  if (!/Class:\s+ELF64/u.test(inspection) || !/Machine:\s+Advanced Micro Devices X86-64/u.test(inspection)) reject('Expected an x86-64 ELF64 binary');
  const interpreter = /Requesting program interpreter:\s*([^\]]+)/u.exec(inspection)?.[1];
  if (interpreter && interpreter !== '/lib64/ld-linux-x86-64.so.2') reject(`Unsupported interpreter ${interpreter}`);
  for (const match of inspection.matchAll(/\(NEEDED\).*\[([^\]]+)\]/gu)) if (!baseLibraries.has(match[1]!) && !bundled.has(match[1]!)) reject(`Unresolved DT_NEEDED ${match[1]}`);
  for (const match of inspection.matchAll(/GLIBC_(\d+)\.(\d+)/gu)) if (Number(match[1]) > 2 || Number(match[1]) === 2 && Number(match[2]) > 39) reject(`Requires ${match[0]}`);
  for (const match of inspection.matchAll(/\((?:RPATH|RUNPATH)\).*\[([^\]]*)\]/gu)) {
    for (const path of match[1]!.split(':')) {
      if (!/^\$ORIGIN(?:\/|$)/u.test(path) || resolve(dirname(file), path.replace('$ORIGIN', '.')) !== join(root, 'runtime/lib')) reject(`RPATH must point to runtime/lib: ${path}`);
    }
  }
  const needsRuntime = [...inspection.matchAll(/\(NEEDED\).*\[([^\]]+)\]/gu)].some(match => !baseLibraries.has(match[1]!));
  if (needsRuntime && !/\((?:RPATH|RUNPATH)\)/u.test(inspection)) reject('Non-glibc ELF dependency lacks an archive RPATH');
}

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md#verify
export const verifyReleaseArchive = Effect.fn('release.verifyArchive')(function*(archivePath: string, expectedVersion: string, checksumsPath: string, expectedCommit = process.env.RELEASE_COMMIT) {
  const fs = yield* FileSystem.FileSystem;
  const version = yield* Schema.decodeUnknownEffect(Version)(expectedVersion);
  const archive = resolve(archivePath);
  const match = /^concord-(.+)-(linux-x64|darwin-arm64)\.tar\.gz$/u.exec(basename(archive));
  if (!match || match[1] !== version) return yield* new ReleaseArchiveInvalid({ message: 'Archive name and release version disagree' });
  const target = yield* Schema.decodeUnknownEffect(Target)(match[2]);
  if ((target === 'linux-x64' ? 'linux' : 'darwin') !== process.platform || (target === 'linux-x64' ? 'x64' : 'arm64') !== process.arch) return yield* new ReleaseArchiveInvalid({ message: `Verify ${target} on its native host` });
  const checksumText = yield* fs.readFileString(resolve(checksumsPath));
  const sums = yield* io('Decode release SHA256SUMS', () => decodeReleaseChecksums(checksumText));
  const digest = createHash('sha256').update(yield* fs.readFile(archive)).digest('hex');
  if (sums.get(basename(archive)) !== digest) return yield* new ReleaseArchiveInvalid({ message: 'Candidate archive checksum differs' });
  const scratch = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-archive-verify-' }).pipe(Effect.flatMap(fs.realPath));
  const options = { cwd: scratch, outputDir: scratch, timeoutMs: 120_000 };
  const run = (args: readonly string[]) => mustRun(args, options);
  const listing = (yield* run(['tar', '-tzf', archive])).stdout.trim().split('\n');
  if (listing.some(name => isAbsolute(name) || name.split('/').includes('..'))) return yield* new ReleaseArchiveInvalid({ message: 'Archive member escapes extraction root' });
  const root = join(scratch, 'install');
  yield* fs.makeDirectory(root);
  yield* run(['tar', '-xzf', archive, '-C', root]);
  const files: string[] = [];
  const walk = Effect.fn('release.walkArchive')(function*(directory: string): Effect.fn.Return<void, unknown, FileSystem.FileSystem> {
    for (const name of yield* fs.readDirectory(directory)) {
      const path = join(directory, name);
      const real = yield* fs.realPath(path);
      if (!within(root, real)) return yield* new ReleaseArchiveInvalid({ message: `Archive link escapes root: ${path}` });
      if ((yield* fs.readLink(path).pipe(Effect.option))._tag === 'Some') continue;
      if ((yield* fs.stat(path)).type === 'Directory') yield* walk(path); else files.push(path);
    }
  });
  yield* walk(root);
  if (target === 'linux-x64') {
    const bundled = new Set(yield* fs.readDirectory(join(root, 'runtime/lib')));
    for (const file of files) {
      const magic = yield* binaryMagic(file);
      if (magic !== '7f454c46') continue;
      const inspection = (yield* run(['readelf', '-h', '-l', '-d', '--version-info', file])).stdout;
      yield* io('Verify ELF closure', () => validateElfInspection(file, root, inspection, bundled));
    }
  } else {
    for (const file of files) {
      if (machoMagic.has(yield* binaryMagic(file))) yield* run(['codesign', '--verify', '--strict', file]);
    }
    if ((yield* run(['xattr', '-lr', root])).stdout.includes('com.apple.quarantine')) return yield* new ReleaseArchiveInvalid({ message: 'Quarantined archive contents' });
  }
  const manifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ version: Version, gitHead: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/u)) })), { onExcessProperty: 'ignore' })(yield* fs.readFileString(join(root, 'app/package.json')));
  if (expectedCommit !== undefined && manifest.gitHead !== expectedCommit) return yield* new ReleaseArchiveInvalid({ message: 'Application commit differs from the candidate tag commit' });
  if (manifest.version !== version) return yield* new ReleaseArchiveInvalid({ message: 'Application version differs from archive' });
  if (!(yield* fs.exists(join(root, 'app/dist/web/index.html')))) return yield* new ReleaseArchiveInvalid({ message: 'Packaged Web resources missing' });
  const bin = join(scratch, 'bin'), consumer = join(scratch, 'consumer');
  yield* fs.makeDirectory(bin); yield* fs.makeDirectory(consumer);
  for (const tool of ['git', 'dirname', 'readlink', 'pwd', 'basename', 'uname', 'sed']) {
    for (const entry of (process.env.PATH ?? '').split(delimiter)) {
      if (yield* fs.exists(join(entry, tool))) { yield* fs.symlink(resolve(entry, tool), join(bin, tool)); break; }
    }
  }
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: bin, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', NODE_OPTIONS: '', NODE_PATH: '', LD_LIBRARY_PATH: '' };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') && !['GIT_CONFIG_GLOBAL','GIT_CONFIG_NOSYSTEM','GIT_TERMINAL_PROMPT'].includes(key)) delete env[key];
  const cli = (args: readonly string[]) => mustRun([join(root, 'bin/concord'), ...args], { ...options, cwd: consumer, env }).pipe(Effect.mapError(error => error.message.includes('PackagedRuntimeUnavailable') ? new PackagedRuntimeUnavailable({ message: error.message }) : error));
  const call = (args: readonly string[]) => cli(['--root', consumer, '--json', '--server=command', ...args]);
  const nativeStatus = Schema.Struct({ cache: Schema.Struct({ status: Schema.String }) });
  yield* mustRun([join(bin, 'git'), 'init', '-q', consumer], { ...options, env });
  if ((yield* cli(['--version'])).stdout.trim() !== `concord v${version}`) return yield* new ReleaseArchiveInvalid({ message: 'CLI version differs' });
  yield* cli(['--help']);
  const compiler = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ version: Schema.String, target: Target, cpu: Schema.String })), { onExcessProperty: 'ignore' })(yield* fs.readFileString(join(root, 'app/dist/compiler.json')));
  const pinnedBun = (yield* fs.readFileString(resolve('.bun-version'))).trim();
  if (compiler.version !== pinnedBun || compiler.target !== target || compiler.cpu !== (target === 'linux-x64' ? 'bun-linux-x64-baseline' : 'bun-darwin-arm64')) return yield* new ReleaseArchiveInvalid({ message: 'Compiled runtime differs from pinned target' });
  if (yield* fs.exists(join(root, 'runtime/node'))) return yield* new ReleaseArchiveInvalid({ message: 'Archive contains a separate JS interpreter' });
  yield* call(['init', '--docs-only']);
  yield* Effect.gen(function*() {
    yield* call(['check']);
    yield* call(['cache', 'clear']);
    const cold = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(nativeStatus))((yield* call(['cache', 'rebuild'])).stdout);
    const warm = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(nativeStatus))((yield* call(['test', 'list'])).stdout);
    if (cold.cache.status !== 'miss' || warm.cache.status !== 'hit') return yield* new ReleaseArchiveInvalid({ message: 'Native HawDB must load and persist a cold/warm cache' });
  }).pipe(Effect.ensuring(cli(['--root', consumer, 'server', 'stop']).pipe(Effect.orDie)));
  const status = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ state: Schema.Literal('absent') })), { onExcessProperty: 'ignore' })((yield* cli(['--root', consumer, '--json', 'server', 'status'])).stdout);
  const processes = (yield* run(['ps', '-axo', 'pid=,command='])).stdout;
  if (processes.split('\n').some(line => line.includes(consumer))) return yield* new ReleaseArchiveInvalid({ message: 'Candidate service process remains after cleanup' });
  return { target, version, digest, native: 'loaded', service: status.state };
}, Effect.scoped);

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  Effect.gen(function*() {
    const args = yield* Schema.decodeUnknownEffect(Schema.Tuple([Schema.String, Schema.String, Schema.String]))(process.argv.slice(2));
    const result = yield* verifyReleaseArchive(...args);
    yield* Effect.sync(() => process.stdout.write(`${JSON.stringify(result)}\n`));
  }).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
