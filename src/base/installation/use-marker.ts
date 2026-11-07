// @concord-file
// @concord-implements docs/feature/cross-platform-release/architecture.md#安装脚本
import { accessSync, constants, lstatSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Effect } from 'effect';
import { ConcordError, failure } from '../../model/index.ts';
import { packageRoot } from './location.ts';
import { makeRuntimeEnvironment, runtimePath, type RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import { sourceInstallation } from './runtime.ts';

/** The server scope owns the marker, including interrupted or failed startup.
 * Exclusive create and inode check keep cleanup from removing a replacement.
 */
export const installationUseMarker = (applicationRoot = packageRoot, source = sourceInstallation, runtime: RuntimeEnvironmentSnapshot = makeRuntimeEnvironment(packageRoot, {})) => Effect.acquireRelease(
  Effect.try({ try: () => {
    if (source) return undefined;
    const root = dirname(runtimePath(runtime, applicationRoot));
    if (!lstatSync(join(root, 'bin/concord'), { throwIfNoEntry: false })?.isFile()) return undefined;
    try { accessSync(root, constants.W_OK); }
    catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EROFS' || code === 'EPERM') return undefined;
      throw cause;
    }
    const directory = join(root, '.in-use');
    const path = join(directory, String(process.pid));
    try {
      mkdirSync(directory, { mode: 0o700 });
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EROFS' || code === 'EPERM') return undefined;
      if (code !== 'EEXIST') throw cause;
    }
    const parent = lstatSync(directory);
    if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid?.()) throw new ConcordError('UnsafePath', 'Installation use markers must be in a user-owned directory');
    try { writeFileSync(path, '', { flag: 'wx', mode: 0o600 }); }
    catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EROFS' || code === 'EPERM') return undefined;
      if (code !== 'EEXIST') throw cause;
    }
    const identity = lstatSync(path, { bigint: true });
    if (!identity.isFile() || identity.isSymbolicLink() || identity.uid !== BigInt(process.getuid?.() ?? -1) || identity.nlink !== 1n) throw new ConcordError('UnsafePath', 'Installation use marker must be a user-owned regular file');
    return { path, identity };
  }, catch: failure }),
  marker => Effect.sync(() => {
    if (!marker) return;
    const actual = lstatSync(marker.path, { bigint: true, throwIfNoEntry: false });
    if (actual?.dev === marker.identity.dev && actual.ino === marker.identity.ino) unlinkSync(marker.path);
  }),
);
