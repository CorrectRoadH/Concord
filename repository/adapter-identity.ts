import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Schema } from 'effect';
import { parse as parseYaml } from 'yaml';
import { readGovernanceConfiguration } from 'concord-sdlc/governance-config';
import { repositoryImplementationDigest } from './identity.js';

export interface RepositoryAdapterSnapshot {
  readonly digest: string;
  readonly sourceDigest: string;
  readonly files: readonly { readonly path: string; readonly digest: string }[];
  readonly argv: readonly [string, ...string[]];
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly responseBytes: number;
}
export class RepositoryAdapterIdentityError extends Error {
  override readonly name = 'RepositoryAdapterInvalid';
}
const sha = (value: string | Uint8Array): string => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const slash = (path: string): string => path.split(sep).join('/');
const invalid = (message: string): never => { throw new RepositoryAdapterIdentityError(message); };

function executable(root: string, command: string): string {
  const candidates = isAbsolute(command) || command.includes('/')
    ? [resolve(root, command)]
    : (process.env.PATH ?? '').split(delimiter).filter(Boolean).map(path => resolve(path, command));
  for (const path of candidates) {
    try {
      accessSync(path, constants.X_OK);
      const actual = realpathSync(path);
      if (lstatSync(actual).isFile()) return actual;
    } catch { /* Try the next explicit PATH member. */ }
  }
  return invalid(`Adapter executable cannot be resolved: ${command}`);
}

/** No subprocess or publication: safe to recompute while a publication lease is held. */
export function repositoryAdapterSnapshot(root: string): RepositoryAdapterSnapshot | undefined {
  const configuration = readGovernanceConfiguration(root);
  const adapter = configuration?.config.adapter;
  if (adapter === undefined || configuration === undefined) return undefined;
  const files = new Map<string, string>();
  let total = 0;
  const add = (path: string): void => {
    const key = slash(relative(root, path));
    if (files.has(key)) return;
    const status = lstatSync(path);
    if (!status.isFile() || status.isSymbolicLink()) invalid(`Adapter input must be a regular file: ${key}`);
    total += status.size;
    if (files.size >= 50_000 || total > 128 * 1024 * 1024) invalid('Adapter implementation exceeds its snapshot budget');
    files.set(key, sha(readFileSync(path)));
  };
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      if (name === '.git' || name === 'node_modules') continue;
      const path = resolve(directory, name);
      const status = lstatSync(path);
      if (status.isSymbolicLink()) invalid(`Adapter implementation cannot contain symlinks: ${slash(relative(root, path))}`);
      if (status.isDirectory()) walk(path);
      else add(path);
    }
  };
  for (const path of adapter.implementationFiles) add(resolve(root, path));
  for (const path of adapter.implementationRoots) {
    const before = files.size;
    walk(resolve(root, path));
    if (before === files.size && ![...files.keys()].some(file => file.startsWith(`${path}/`))) invalid(`Adapter implementation root is empty: ${path}`);
  }
  // Existing dependency declarations must participate even when the launcher is plain Node.
  for (const path of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock']) {
    if (existsSync(resolve(root, path)) && !files.has(path)) invalid(`Declare adapter dependency input: ${path}`);
  }
  for (const argument of adapter.argv.slice(1)) {
    if (!/\.(?:[cm]?[jt]sx?|py|rb)$/u.test(argument)) continue;
    const path = slash(relative(root, resolve(root, argument)));
    if (!files.has(path)) invalid(`Adapter script must be declared: ${argument}`);
  }
  const binary = executable(root, adapter.argv[0]);
  const loader: [string, string][] = [];
  for (let index = 1; index < adapter.argv.length; index += 1) {
    const flag = adapter.argv[index]!;
    if (!['--import', '--loader', '--experimental-loader', '-r', '--require'].includes(flag) && !/^(?:--import|--loader|--experimental-loader|--require)=/u.test(flag)) continue;
    const specifier = flag.includes('=') ? flag.slice(flag.indexOf('=') + 1) : adapter.argv[++index];
    if (specifier !== 'tsx') invalid('Repository adapters support only the locked tsx loader');
    if (!files.has('pnpm-lock.yaml')) invalid('The tsx adapter loader requires a declared pnpm lockfile');
    const require = createRequire(resolve(root, 'package.json'));
    const manifestPath = require.resolve('tsx/package.json');
    const manifest = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String }), { onExcessProperty: 'ignore' })(JSON.parse(readFileSync(manifestPath, 'utf8')));
    const lock = Schema.decodeUnknownSync(Schema.Struct({ importers: Schema.Record(Schema.String, Schema.Struct({
      dependencies: Schema.optional(Schema.Record(Schema.String, Schema.Struct({ version: Schema.String }))),
      devDependencies: Schema.optional(Schema.Record(Schema.String, Schema.Struct({ version: Schema.String }))),
    })) }), { onExcessProperty: 'ignore' })(parseYaml(readFileSync(resolve(root, 'pnpm-lock.yaml'), 'utf8')));
    const locked = lock.importers['.'];
    const version = locked?.dependencies?.tsx?.version ?? locked?.devDependencies?.tsx?.version;
    if (version?.split('(')[0] !== manifest.version) invalid('Installed tsx loader does not match the consumer lockfile');
    const entry = realpathSync(require.resolve('tsx'));
    loader.push([entry, sha(readFileSync(entry))], [realpathSync(manifestPath), sha(readFileSync(manifestPath))]);
  }
  const env: Record<string, string> = {};
  for (const name of adapter.envNames) if (process.env[name] !== undefined) env[name] = process.env[name]!;
  const sourceDigest = sha(JSON.stringify({
    format: 'concord.repository-adapter-source/v1', configuration: configuration.digest,
    files: [...files].sort(([left], [right]) => left.localeCompare(right)),
    executable: [binary, sha(readFileSync(binary))], node: process.version, loader,
  }));
  const digest = sha(JSON.stringify({ sourceDigest, engine: repositoryImplementationDigest() }));
  return { digest, sourceDigest, files: [...files].map(([path, digest]) => ({ path, digest })), argv: [binary, ...adapter.argv.slice(1)], env,
    timeoutMs: adapter.timeoutMs ?? 1_800_000, responseBytes: adapter.responseBytes ?? 32 * 1024 * 1024 };
}

export function repositoryEngineDescriptor(): { readonly argv: readonly [string, ...string[]]; readonly implementationDigest: string } {
  const entry = resolve(dirname(fileURLToPath(import.meta.url)), '../entry.js');
  if (!existsSync(entry)) invalid('Repository adapter requires the built Concord CLI');
  return { argv: [process.execPath, entry, 'repo', 'engine', '--json'], implementationDigest: repositoryImplementationDigest() };
}
