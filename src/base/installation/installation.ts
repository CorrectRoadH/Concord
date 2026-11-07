// @concord-file
// @concord-implements docs/engineering/build/architecture.md#从源码运行
import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "./location.ts";
import { hawdbTarget } from "./hawdb-native-contract.ts";
import { ConcordError } from "../../model/index.ts";
import { makeRuntimeEnvironment, type RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import { installationIdentity } from './identity-cache.ts';
import { sourceInstallation, runtimeDirectory, runtimeLoader } from './runtime.ts';

const directory = runtimeDirectory;
const defaultRuntime = makeRuntimeEnvironment(packageRoot, {});
const distribution = join(packageRoot, 'dist');
import { nativeArtifactRoot, verifySourceNativeArtifact } from "./native-artifact.ts";

/** Resolve the loader at the installation, independently of a consumer's cwd. */
export function workerEntryArgv(name: 'test-adapter-vitest' | 'query-refresh-worker' | 'query-scan-worker' | 'editor-worker' | 'view-scan-worker' | 'cache-maintenance-worker' | 'compute-worker' | 'workspace-server' | 'operation-worker' | 'web-build', runtimeOptions: readonly string[] = []): string[] {
  if (!sourceInstallation) {
    if (runtimeOptions.length > 0) throw new ConcordError('InvalidOption', 'Compiled workers do not accept interpreter options');
    if (name === 'web-build') throw new ConcordError('InvalidOption', 'Web building is available only in a source checkout');
    return name === 'workspace-server' ? ['server', 'run', '--root'] : ['--concord-internal', name];
  }
  if (name === 'web-build') return [...runtimeOptions, ...runtimeLoader(), join(directory, 'entry/web-build/main.ts')];
  if (name === 'workspace-server') return [...runtimeOptions, ...runtimeLoader(), join(directory, 'entry/cli/entry.ts'), 'server', 'run', '--root'];
  if (name === 'operation-worker') return [...runtimeOptions, ...runtimeLoader(), join(directory, 'entry/server/operation/main.ts')];
  return [...runtimeOptions, ...runtimeLoader(), join(directory, 'entry/server', `${name}.ts`)];
}

export function builtAssetRoot(name: 'web' | 'preview' | 'p5-types'): string {
  if (sourceInstallation) return name === 'p5-types' ? join(packageRoot, 'node_modules/p5/types') : join(packageRoot, 'web', ...(name === 'preview' ? ['preview'] : []));
  return join(distribution, name);
}

export function requireBuiltAssets(): void {
  // Source assets are supplied by the shared Web cache.
}

type InstallationFiles = string[][];
function requireNativeArtifacts(runtime: RuntimeEnvironmentSnapshot): void {
  for (const name of ['artifact.json', 'hawdb.node', 'THIRD-PARTY-NOTICES.txt']) {
    if (lstatSync(join(nativeArtifactRoot(runtime), hawdbTarget(), name), { throwIfNoEntry: false }) === undefined) {
      throw new ConcordError('HawdbUnavailable', 'Required native cache artifact is missing; run bun run build:native.');
    }
  }
  if (sourceInstallation) verifySourceNativeArtifact(runtime);
}

/** Query and workspace caches share the complete implementation identity. */
export function queryInstallationIdentity(runtime: RuntimeEnvironmentSnapshot = defaultRuntime): InstallationFiles {
  return [['implementation', workspaceInstallationIdentity(runtime)]];
}

/** Metadata fingerprints avoid rehashing an unchanged installation across processes. */
export function workspaceInstallationIdentity(runtime: RuntimeEnvironmentSnapshot = defaultRuntime): string {
  requireNativeArtifacts(runtime);
  const runtimeIdentity = [['mode', sourceInstallation ? 'source' : 'compiled'], ['bun', process.versions.bun ?? 'unavailable']];
  return sourceInstallation
    ? installationIdentity(directory, [{ root: directory, prefix: 'src', accept: () => true }, { root: join(packageRoot, 'web'), prefix: 'web', accept: () => true }, { root: nativeArtifactRoot(runtime), prefix: 'native', accept: () => true },
      ...['package.json', 'bun.lock', '.bun-version', 'native-release.json', 'patches'].map(path => ({ root: join(packageRoot, path), prefix: path, accept: () => true })),
    ], runtimeIdentity, runtime)
    : installationIdentity(packageRoot, [
      { root: packageRoot, prefix: 'app', accept: () => true, linkRoot: realpathSync(packageRoot) },
      { root: realpathSync(process.execPath), prefix: 'bin/concord', accept: () => true },
    ], runtimeIdentity, runtime);
}

