// @concord-file
// @concord-implements docs/engineering/concord-self-hosting/README.md#从源码运行
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "./location.js";
export { packageRoot } from "./location.js";
import { hawdbTarget } from "./hawdb-native-contract.js";
import { ConcordError, digest } from "../../model/index.js";
import { installationIdentity } from './identity-cache.js';
import { sourceInstallation, runtimeDirectory, runtimeLoader } from './runtime.js';
export { sourceInstallation } from './runtime.js';

const directory = runtimeDirectory;
const distribution = join(packageRoot, 'dist');
export { nativeArtifactRoot, verifySourceNativeArtifact } from "./native-artifact.js";
import { nativeArtifactRoot, verifySourceNativeArtifact } from "./native-artifact.js";
export const resourcePath = (path: string): string => join(packageRoot, path);
export const helpManifestPath = join(distribution, 'startup-data.js');

/** Resolve the loader at the installation, independently of a consumer's cwd. */
export function workerEntryArgv(name: 'test-adapter-vitest' | 'query-refresh-worker' | 'query-scan-worker' | 'editor-worker' | 'view-scan-worker' | 'cache-maintenance-worker' | 'compute-worker' | 'workspace-server' | 'operation-worker', nodeOptions: readonly string[] = []): string[] {
  if (name === 'workspace-server') return [...nodeOptions, ...runtimeLoader(), join(directory, 'entry/cli', `entry.${sourceInstallation ? 'ts' : 'js'}`), 'server', 'run', '--root'];
  if (name === 'operation-worker') return [...nodeOptions, ...runtimeLoader(), join(directory, 'entry/server/operation', `main.${sourceInstallation ? 'ts' : 'js'}`)];
  return [...nodeOptions, ...runtimeLoader(), join(directory, 'entry/server', `${name}.${sourceInstallation ? 'ts' : 'js'}`)];
}

export function builtAssetRoot(name: 'web' | 'preview' | 'p5-types'): string {
  if (sourceInstallation) return name === 'p5-types' ? join(packageRoot, 'node_modules/p5/types') : join(packageRoot, 'web', ...(name === 'preview' ? ['preview'] : []));
  return join(distribution, name);
}

export function requireBuiltAssets(): void {
  // Both runtime modes provide assets: Vite compiles source assets on demand.
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

function requireNativeArtifacts(): void {
  for (const name of ['artifact.json', 'hawdb.node', 'THIRD-PARTY-NOTICES.txt']) {
    if (lstatSync(join(nativeArtifactRoot, hawdbTarget(), name), { throwIfNoEntry: false }) === undefined) {
      throw new ConcordError('HawdbUnavailable', 'Required native cache artifact is missing; run pnpm exec vp run build:native.');
    }
  }
  if (sourceInstallation) verifySourceNativeArtifact();
}

function sourceIdentity(): InstallationFiles {
  requireNativeArtifacts();
  return [['mode', 'source'], ...collectFiles(directory, 'src', () => true), ...collectFiles(join(packageRoot, 'web'), 'web', () => true),
    ...collectFiles(nativeArtifactRoot, 'native', () => true)];
}

/** Preserve the built query key's ordered file list. Source and built keys never overlap. */
export function queryInstallationIdentity(): InstallationFiles {
  if (sourceInstallation) return sourceIdentity();
  const files = collectFiles(directory, '', (name, relative) => name.endsWith('.js') && !relative.startsWith('native/'));
  for (const target of readdirSync(nativeArtifactRoot).sort()) {
    for (const name of ['artifact.json', 'hawdb.node']) files.push([`native/${target}/${name}`, digest(readFileSync(join(nativeArtifactRoot, target, name)))]);
  }
  return files;
}

/** Metadata fingerprints avoid rehashing an unchanged installation across processes. */
export function workspaceInstallationIdentity(): string {
  requireNativeArtifacts();
  return sourceInstallation
    ? installationIdentity(directory, [{ root: directory, prefix: 'src', accept: () => true }, { root: join(packageRoot, 'web'), prefix: 'web', accept: () => true }, { root: nativeArtifactRoot, prefix: 'native', accept: () => true }], [['mode', 'source']])
    : installationIdentity(directory, [{ root: directory, prefix: '', accept: (name, relative) => name.endsWith('.js') || relative.startsWith('native/') }]);
}
export * from './hawdb-native-contract.js';
export { nativeSourceDigest, nativeCacheRoot, nativeSourceFiles, nativeLockDigest } from './native-artifact.js';
export { installationResources, installationRootForBin } from './resources.js';
export { Installation } from './service.js';
export type { TemplateResources } from './service.js';
