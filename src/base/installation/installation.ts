// @concord-file
// @concord-implements docs/engineering/build/architecture.md#从源码运行
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "./location.ts";
import { hawdbTarget } from "./hawdb-native-contract.ts";
import { ConcordError, digest } from "../../model/index.ts";
import { makeRuntimeEnvironment, type RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import { installationIdentity } from './identity-cache.ts';
import { sourceInstallation, runtimeDirectory, runtimeLoader } from './runtime.ts';
import { resourcePath as installedResourcePath } from './startup/index.ts';

const directory = runtimeDirectory;
const defaultRuntime = makeRuntimeEnvironment(packageRoot, {});
const distribution = join(packageRoot, 'dist');
import { nativeArtifactRoot, verifySourceNativeArtifact } from "./native-artifact.ts";
export const resourcePath: typeof installedResourcePath = path => installedResourcePath(path);
export const helpManifestPath = join(distribution, 'startup-data.js');

/** Resolve the loader at the installation, independently of a consumer's cwd. */
export function workerEntryArgv(name: 'test-adapter-vitest' | 'query-refresh-worker' | 'query-scan-worker' | 'editor-worker' | 'view-scan-worker' | 'cache-maintenance-worker' | 'compute-worker' | 'workspace-server' | 'operation-worker' | 'web-build', nodeOptions: readonly string[] = []): string[] {
  if (name === 'web-build') return [...nodeOptions, ...runtimeLoader(), join(directory, 'entry/web-build', `main.${sourceInstallation ? 'ts' : 'js'}`)];
  if (name === 'workspace-server') return [...nodeOptions, ...runtimeLoader(), join(directory, 'entry/cli', `entry.${sourceInstallation ? 'ts' : 'js'}`), 'server', 'run', '--root'];
  if (name === 'operation-worker') return [...nodeOptions, ...runtimeLoader(), join(directory, 'entry/server/operation', `main.${sourceInstallation ? 'ts' : 'js'}`)];
  return [...nodeOptions, ...runtimeLoader(), join(directory, 'entry/server', `${name}.${sourceInstallation ? 'ts' : 'js'}`)];
}

export function builtAssetRoot(name: 'web' | 'preview' | 'p5-types'): string {
  if (sourceInstallation) return name === 'p5-types' ? join(packageRoot, 'node_modules/p5/types') : join(packageRoot, 'web', ...(name === 'preview' ? ['preview'] : []));
  return join(distribution, name);
}

export function requireBuiltAssets(): void {
  // Source assets are supplied by the shared Web cache.
}

type InstallationFiles = string[][];
function collectFiles(root: string, relative: string, accept: (name: string, relative: string) => boolean): InstallationFiles {
  const files: InstallationFiles = [];
  const visit = (path: string, prefix: string): void => {
    for (const name of readdirSync(path).sort()) {
      const target = join(path, name), rel = prefix ? `${prefix}/${name}` : name;
      const entry = lstatSync(target);
      if (entry.isSymbolicLink()) throw new ConcordError('UnsafePath', 'Installation contains a symbolic link');
      if (entry.isDirectory()) visit(target, rel);
      else if (entry.isFile() && accept(name, rel)) files.push([rel, digest(readFileSync(target))]);
    }
  };
  visit(root, relative);
  return files;
}

function requireNativeArtifacts(runtime: RuntimeEnvironmentSnapshot): void {
  for (const name of ['artifact.json', 'hawdb.node', 'THIRD-PARTY-NOTICES.txt']) {
    if (lstatSync(join(nativeArtifactRoot(runtime), hawdbTarget(), name), { throwIfNoEntry: false }) === undefined) {
      throw new ConcordError('HawdbUnavailable', 'Required native cache artifact is missing; run pnpm exec vp run build:native.');
    }
  }
  if (sourceInstallation) verifySourceNativeArtifact(runtime);
}

function sourceIdentity(runtime: RuntimeEnvironmentSnapshot): InstallationFiles {
  requireNativeArtifacts(runtime);
  return [['mode', 'source'], ...collectFiles(directory, 'src', () => true), ...collectFiles(join(packageRoot, 'web'), 'web', () => true),
    ...collectFiles(nativeArtifactRoot(runtime), 'native', () => true)];
}

/** Preserve the built query key's ordered file list. Source and built keys never overlap. */
export function queryInstallationIdentity(runtime: RuntimeEnvironmentSnapshot = defaultRuntime): InstallationFiles {
  if (sourceInstallation) return sourceIdentity(runtime);
  const files = collectFiles(directory, '', (name, relative) => name.endsWith('.js') && !relative.startsWith('native/'));
  for (const target of readdirSync(nativeArtifactRoot(runtime)).sort()) {
    for (const name of ['artifact.json', 'hawdb.node']) files.push([`native/${target}/${name}`, digest(readFileSync(join(nativeArtifactRoot(runtime), target, name)))]);
  }
  return files;
}

/** Metadata fingerprints avoid rehashing an unchanged installation across processes. */
export function workspaceInstallationIdentity(runtime: RuntimeEnvironmentSnapshot = defaultRuntime): string {
  requireNativeArtifacts(runtime);
  return sourceInstallation
    ? installationIdentity(directory, [{ root: directory, prefix: 'src', accept: () => true }, { root: join(packageRoot, 'web'), prefix: 'web', accept: () => true }, { root: nativeArtifactRoot(runtime), prefix: 'native', accept: () => true }], [['mode', 'source']], runtime)
    : installationIdentity(directory, [{ root: directory, prefix: '', accept: (name, relative) => name.endsWith('.js') || relative.startsWith('native/') }], [], runtime);
}

