// @concord-file
// @concord-implements docs/engineering/build/architecture.md#编译入口
import { join } from 'node:path';
import { compiledStartupReceipts } from './compile-startup.ts';
import { Effect, FileSystem } from 'effect';
import { archivePartInput, cachedArchivePart } from './application-cache.ts';
import { ArchiveFailed, archiveTarget, command, run, sha256, type ArchiveTarget } from './archive-support.ts';

export const compilationTarget = (target: ArchiveTarget) => target === 'linux-x64' ? 'bun-linux-x64-baseline' : 'bun-darwin-arm64';

/** Bytecode belongs to the target host, including when called outside distribution. */
export function assertCompilationHost(target: ArchiveTarget): void {
  if (target !== archiveTarget(`${process.platform}-${process.arch}`)) {
    throw new ArchiveFailed({ message: `Compile ${target} on its target host; cross-host bytecode is forbidden` });
  }
}

export const bunCompilerIdentity = Effect.fn('build.bunIdentity')(function*(repository: string, target: ArchiveTarget) {
  yield* Effect.try({ try: () => assertCompilationHost(target), catch: cause => cause });
  const fs = yield* FileSystem.FileSystem;
  const pinned = (yield* fs.readFileString(join(repository, '.bun-version'))).trim();
  const revision = (yield* command('bun', ['--revision'])).trim();
  const version = (yield* command('bun', ['--version'])).trim();
  if (version !== pinned) return yield* new ArchiveFailed({ message: `Bun version ${version} differs from .bun-version ${pinned}` });
  const executable = (yield* command('bun', ['--no-env-file', '--config=/dev/null', '-p', 'process.execPath'], repository)).trim();
  return { version, revision, binarySha256: sha256(yield* fs.readFile(executable)), target, cpu: compilationTarget(target) };
});

export const compilationArguments = (target: ArchiveTarget, output: string) => [
  '--no-env-file', '--config=/dev/null', 'build', 'src/entry/compiled/main.ts',
  '--compile', '--bytecode', '--format=esm', `--target=${compilationTarget(target)}`,
  '--define', 'CONCORD_COMPILED=true', '--no-compile-autoload-dotenv', '--no-compile-autoload-bunfig',
  '--no-compile-autoload-tsconfig', '--compile-autoload-package-json', '--outfile', output,
];

/** Cache unrelocated bytes only; every archive transforms its own private copy. */
export const compileApplication = Effect.fn('build.compileApplication')(function*(repository: string, target: ArchiveTarget) {
  const fs = yield* FileSystem.FileSystem;
  const identity = yield* bunCompilerIdentity(repository, target);
  const input = () => Effect.gen(function*() {
    const current = yield* bunCompilerIdentity(repository, target);
    return yield* archivePartInput(repository, ['src', 'native-release.json', 'package.json', 'bun.lock', 'patches', '.bun-version',
    'tsconfig.json', 'scripts/compile-application.ts', 'scripts/compile-startup.ts', 'scripts/application-cache.ts', 'scripts/gate-build-cache.ts',
    'scripts/archive-support.ts', 'node_modules/typescript/package.json'], current);
  });
  const compiled = yield* cachedArchivePart('compiled', yield* input(), output => Effect.gen(function*() {
    // Bun only transpiles; the pinned native TypeScript compiler owns type safety.
    yield* run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--noEmit'], repository);
    yield* fs.makeDirectory(output, { recursive: true });
    const receipts = yield* compiledStartupReceipts(repository);
    yield* run('bun', [...compilationArguments(target, join(output, 'concord')), '--define', `CONCORD_STARTUP_RECEIPTS=${JSON.stringify(receipts)}`], repository);
    yield* fs.chmod(join(output, 'concord'), 0o755);
    yield* fs.writeFileString(join(output, 'compiler.json'), `${JSON.stringify(identity)}\n`);
  }), input);
  return { directory: compiled, identity };
});
