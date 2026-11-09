import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { Effect, FileSystem, Schema } from 'effect';
import { archivePartInput, cachedArchivePart } from './application-cache.ts';
import { ArchiveFailed, attempt, command, readJson, run, sha256, verifiedDownload } from './archive-support.ts';

const systemLibraries = new Set(['libc.so.6', 'libm.so.6', 'libdl.so.2', 'libpthread.so.0', 'librt.so.1', 'ld-linux-x86-64.so.2']);
export const parseElf = (text: string) => ({
  dynamic: /\(NEEDED\)|Requesting program interpreter:/u.test(text),
  needed: [...text.matchAll(/\(NEEDED\).*\[([^\]]+)\]/gu)].map(match => match[1]!),
  interpreter: /Requesting program interpreter:\s*([^\]]+)/u.exec(text)?.[1],
  paths: [...text.matchAll(/\((?:RUNPATH|RPATH)\).*\[([^\]]*)\]/gu)].flatMap(match => match[1]!.split(':')),
  glibc: [...text.matchAll(/\bGLIBC_(\d+)\.(\d+)(?:\.(\d+))?/gu)].map(match => [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] as const),
});
export function assertGlibcBaseline(text: string, file: string): void {
  if (parseElf(text).glibc.some(([major, minor]) => major > 2 || major === 2 && minor > 39)) throw new ArchiveFailed({ message: `${file}: requires GLIBC newer than 2.39` });
}
const elfInfo = (file: string) => command('readelf', ['-h', '-l', '-d', '-V', file]);
export const archiveElfFiles = Effect.fn('archive.elfFiles')(function*(root: string) {
  const fs = yield* FileSystem.FileSystem;
  const seen = new Set<string>();
  const names = yield* fs.readDirectory(root, { recursive: true });
  const files = yield* Effect.forEach(names, name => Effect.gen(function*() {
    const file = join(root, name);
    if ((yield* fs.stat(file)).type !== 'File') return undefined;
    const canonical = yield* fs.realPath(file);
    if (seen.has(canonical)) return undefined;
    seen.add(canonical);
    const head = yield* Effect.scoped(Effect.gen(function*() {
      const handle = yield* fs.open(file, { flag: 'r' });
      const head = new Uint8Array(4);
      yield* handle.read(head);
      return head;
    }));
    return Buffer.from(head).equals(Buffer.from([127, 69, 76, 70])) ? canonical : undefined;
  }), { concurrency: 8 });
  return files.filter(file => file !== undefined);

}, Effect.scoped);

const ubuntuPackageNames = ['gcc-14-base', 'libatomic1', 'libstdc++6', 'libgcc-s1'] as const;
const UbuntuPackage = Schema.Struct({
  name: Schema.Literals(ubuntuPackageNames),
  filename: Schema.String.check(Schema.isPattern(/^pool\/main\/[^\s]+\.deb$/u)),
  digest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)),
});
const UbuntuPackages = Schema.Array(UbuntuPackage);

/** Resolve mutable upstream metadata once, then pass immutable package identities
 * to build children so the final archive key and actual libraries agree. */
export const ubuntuRuntimeMetadata = Effect.fn('archive.ubuntuMetadata')(function*() {
  const inherited = process.env.CONCORD_UBUNTU_RUNTIME_PACKAGES;
  if (inherited !== undefined) {
    const packages = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(UbuntuPackages), { onExcessProperty: 'error' })(inherited);
    if (JSON.stringify(packages.map(item => item.name)) !== JSON.stringify(ubuntuPackageNames)) return yield* new ArchiveFailed({ message: 'Invalid Ubuntu runtime package selection' });
    return packages;
  }
  const response = yield* attempt(() => fetch('https://archive.ubuntu.com/ubuntu/dists/noble-updates/main/binary-amd64/Packages.gz', { signal: AbortSignal.timeout(60_000) }));
  if (!response.ok) return yield* new ArchiveFailed({ message: `Ubuntu package index returned ${response.status}` });
  const index = yield* attempt(async () => gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8'));
  const packages: typeof UbuntuPackage.Type[] = [];
  for (const name of ubuntuPackageNames) {
    const block = index.split('\n\n').find(block => block.startsWith(`Package: ${name}\n`));
    packages.push(yield* Schema.decodeUnknownEffect(UbuntuPackage)({ name,
      filename: /^Filename: (.+)$/mu.exec(block ?? '')?.[1], digest: /^SHA256: (.+)$/mu.exec(block ?? '')?.[1],
    }));
  }
  yield* Effect.sync(() => { process.env.CONCORD_UBUNTU_RUNTIME_PACKAGES = JSON.stringify(packages); });
  return packages;
});

/** Obtain Ubuntu 24.04 runtime libraries, never the Nix host's newer libc stack. */
export const ubuntuRuntimeLibraries = Effect.fn('archive.ubuntuLibraries')(function*() {
  const fs = yield* FileSystem.FileSystem;
  const packages = yield* ubuntuRuntimeMetadata();
  const input = yield* archivePartInput(resolve(import.meta.dirname, '..'), ['scripts/archive-linux.ts', 'scripts/archive-support.ts', 'scripts/application-cache.ts', 'scripts/build-cache.ts'], packages);
  const scratch = yield* cachedArchivePart('linux-runtime', input, scratch => Effect.gen(function*() {
    yield* fs.makeDirectory(scratch, { recursive: true });
    for (const { name, filename, digest } of packages) {
    const deb = yield* verifiedDownload(`https://archive.ubuntu.com/ubuntu/${filename}`, digest);
    const bytes = yield* fs.readFile(deb);
    // Debian's ar container has fixed-width ASCII headers; tar handles its payload.
    if (Buffer.from(bytes.subarray(0, 8)).toString() !== '!<arch>\n') return yield* new ArchiveFailed({ message: 'Invalid Debian ar header' });
    let data: Uint8Array | undefined;
    for (let offset = 8; offset + 60 <= bytes.length;) {
      const header = Buffer.from(bytes.subarray(offset, offset + 60)).toString();
      const length = Number(header.slice(48, 58).trim());
      if (!Number.isSafeInteger(length) || length < 0 || offset + 60 + length > bytes.length || header.slice(58) !== '`\n') return yield* new ArchiveFailed({ message: 'Invalid Debian ar member' });
      if (header.slice(0, 16).trim().replace(/\/$/u, '').startsWith('data.tar.')) data = bytes.subarray(offset + 60, offset + 60 + length);
      offset += 60 + length + length % 2;
    }
    if (!data) return yield* new ArchiveFailed({ message: `Missing Debian data: ${name}` });
    const payload = join(scratch, `${name}.tar`);
    yield* fs.writeFile(payload, data);
    yield* run('tar', ['-xf', payload, '-C', scratch]);
  }
  }));
  return { libraries: join(scratch, 'usr/lib/x86_64-linux-gnu'), licenses: join(scratch, 'usr/share/doc') };
});


/** Always break package-cache hardlinks before changing ELF bytes. */
export const relocateElf = Effect.fn('archive.relocateElf')(function*(file: string, rpath: string, hasInterpreter: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const staged = `${file}.relocate-${randomUUID()}`;
  yield* Effect.acquireRelease(fs.copyFile(file, staged), () => fs.remove(staged, { force: true }).pipe(Effect.orDie));
  yield* run('patchelf', ['--force-rpath', '--set-rpath', rpath, staged]);
  if (hasInterpreter) yield* run('patchelf', ['--set-interpreter', '/lib64/ld-linux-x86-64.so.2', staged]);
  yield* fs.rename(staged, file);
}, Effect.scoped);

/** Pure glibc executables need no library relocation. In particular, moving
 * Bun's version-definition section with patchelf can invalidate DT_VERDEF. */
export const relocateLinuxElf = Effect.fn('archive.relocateLinuxElf')(function*(file: string, libraryRoot: string, inspection: string) {
  const info = parseElf(inspection);
  if (!info.needed.some(name => !systemLibraries.has(name))) return false;
  const path = relative(dirname(file), libraryRoot).split('\\').join('/');
  yield* relocateElf(file, path ? `$ORIGIN/${path}` : '$ORIGIN', info.interpreter !== undefined);
  return true;
});

export const closeLinuxRuntime = Effect.fn('archive.linuxClosure')(function*(root: string, libraryDirectory?: string) {
  const fs = yield* FileSystem.FileSystem;
  const source = libraryDirectory ? { libraries: libraryDirectory, licenses: join(libraryDirectory, 'licenses') } : yield* ubuntuRuntimeLibraries();
  const libraryRoot = join(root, 'runtime/lib');
  yield* fs.makeDirectory(libraryRoot, { recursive: true });
  const copyLicense = Effect.fn('archive.copyLinuxLicense')(function*(input: string, output: string): Effect.fn.Return<void, unknown, FileSystem.FileSystem> {
    const resolved = yield* fs.realPath(input);
    if ((yield* fs.stat(resolved)).type === 'Directory') {
      yield* fs.makeDirectory(output, { recursive: true });
      for (const name of yield* fs.readDirectory(resolved)) yield* copyLicense(join(resolved, name), join(output, name));
    } else yield* fs.copyFile(resolved, output);
  });
  yield* copyLicense(source.licenses, join(root, 'licenses/linux-runtime'));
  const copied = new Set<string>();
  const copyLibrary = Effect.fn('archive.copyRuntimeLibrary')(function*(name: string) {
    if (copied.has(name)) return;
    if (basename(name) !== name || !(yield* fs.exists(join(source.libraries, name)))) return yield* new ArchiveFailed({ message: `Unresolved non-glibc runtime dependency: ${name}` });
    yield* fs.copyFile(yield* fs.realPath(join(source.libraries, name)), join(libraryRoot, name));
    copied.add(name);
  });
  yield* copyLibrary('libatomic.so.1');
  yield* copyLibrary('libstdc++.so.6');
  let files = yield* archiveElfFiles(root);
  for (let index = 0; index < files.length; index++) {
    const file = files[index]!;
    const text = yield* elfInfo(file);
    yield* Effect.try({ try: () => assertGlibcBaseline(text, file), catch: cause => cause });
    if (!/Machine:\s+Advanced Micro Devices X86-64/u.test(text)) return yield* new ArchiveFailed({ message: `Unexpected Linux ELF architecture: ${file}` });
    const info = parseElf(text);
    if (!info.dynamic) continue;
    for (const dependency of info.needed) {
      if (systemLibraries.has(dependency)) continue;
      if (!copied.has(dependency)) {
        yield* copyLibrary(dependency);
        files.push(join(libraryRoot, dependency));
      }
    }
    yield* relocateLinuxElf(file, libraryRoot, text);
  }
  files = yield* archiveElfFiles(root);
  for (const file of files) {
    const text = yield* elfInfo(file);
    yield* Effect.try({ try: () => assertGlibcBaseline(text, file), catch: cause => cause });
    const info = parseElf(text);
    if (info.interpreter && info.interpreter !== '/lib64/ld-linux-x86-64.so.2') return yield* new ArchiveFailed({ message: `Invalid ELF interpreter: ${file}` });
    for (const needed of info.needed) if (!systemLibraries.has(needed) && !(yield* fs.exists(join(libraryRoot, needed)))) return yield* new ArchiveFailed({ message: `Unresolved ELF dependency: ${needed}` });
    if (info.needed.some(name => !systemLibraries.has(name)) && info.paths.length === 0) return yield* new ArchiveFailed({ message: `Non-glibc ELF dependency requires an archive RPATH: ${file}` });
    for (const path of info.paths) {
      if (!/^\$ORIGIN(?:\/.*)?$/u.test(path) || resolve(dirname(file), path.replace(/^\$ORIGIN\/?/u, '')) !== resolve(libraryRoot)) return yield* new ArchiveFailed({ message: `ELF RPATH escapes runtime/lib: ${file}: ${path}` });
    }
  }
  // Relocation changes bytes. Preserve every source identity field, rebind only the digest.
  for (const file of files.filter(file => file.endsWith('/hawdb.node'))) {
    const manifest = join(dirname(file), 'artifact.json');
    const { NativeArtifactSchema } = yield* Effect.promise(() => import('../src/base/installation/hawdb-native-contract.ts'));
    const artifact = yield* readJson(manifest, NativeArtifactSchema);
    yield* fs.writeFileString(manifest, JSON.stringify({ ...artifact, binarySha256: sha256(yield* fs.readFile(file)) }) + '\n');
  }
});
