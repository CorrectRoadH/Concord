import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, Schema } from 'effect';
import { parseDocument, visit } from 'yaml';
import { PackageArtifact, packConcord as packRelease } from '../../scripts/release-package.js';
import type { PackedConcord } from '../../scripts/release-package.js';

const sourceRoot = fileURLToPath(new URL('../..', import.meta.url));
const Manifest = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
const InstallState = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ state: Schema.Literal('ready') }),
  Schema.Struct({ state: Schema.Literal('failed'), detail: Schema.String }),
]));
class TestInstallFailed extends Schema.TaggedError<TestInstallFailed>()('TestInstallFailed', { detail: Schema.String }) {}

/** The invocation owns one immutable archive, shared by both runners. */
export function packConcord(destination: string): PackedConcord {
  const manifest = process.env.CONCORD_TEST_ARTIFACT;
  if (manifest === undefined) return packRelease(destination);
  return Effect.runSync(Effect.sync(() => Schema.decodeUnknownSync(Schema.fromJsonString(PackageArtifact), { onExcessProperty: 'error' })(readFileSync(manifest, 'utf8'))));
}

function install(directory: string, artifact: PackedConcord, dependencies: readonly string[], manifest: Record<string, unknown>, privateInstall: boolean): void {
  const { packageManager } = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ packageManager: Schema.String })))(readFileSync(join(sourceRoot, 'package.json'), 'utf8'));
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify({ ...manifest, packageManager }, null, 2)}\n`);
  copyFileSync(join(sourceRoot, 'pnpm-workspace.yaml'), join(directory, 'pnpm-workspace.yaml'));
  execFileSync('pnpm', ['add', '--workspace-root', '--ignore-scripts', '--prefer-offline',
    ...(privateInstall ? ['--package-import-method=copy'] : []), '--save-exact', artifact.filename, ...dependencies], {
    cwd: directory, encoding: 'utf8', timeout: 120_000,
  });
}

/** Shared package contents are read-only. Opt in to a private copy before modifying them. */
export function installConcord(directory: string, artifact: PackedConcord, dependencies: readonly string[] = [], options: { private?: boolean } = {}): void {
  Effect.runSync(Effect.sync(() => {
    const manifest = Schema.decodeUnknownSync(Manifest)(readFileSync(join(directory, 'package.json'), 'utf8'));
    const run = process.env.CONCORD_TEST_INSTALLS;
    if (options.private || run === undefined) {
      install(directory, artifact, dependencies, manifest, true);
      return;
    }
    const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;
    const dependencySet = Object.fromEntries(dependencyFields.map(name => [name,
      Object.fromEntries(Object.entries(Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.String))(manifest[name] ?? {})).sort(([a], [b]) => a.localeCompare(b))),
    ]));
    const key = createHash('sha256').update(JSON.stringify({ dependencySet, dependencies: [...new Set(dependencies)].sort() })).digest('hex');
    mkdirSync(run, { recursive: true });
    const shared = join(run, key);
    const status = join(shared, 'status.json');
    let owner = false;
    try { mkdirSync(shared); owner = true; }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause; }
    if (owner) {
      try {
        install(shared, artifact, dependencies, { private: true, ...dependencySet }, false);
        writeFileSync(`${status}.tmp`, JSON.stringify({ state: 'ready' }));
        renameSync(`${status}.tmp`, status);
      } catch (cause) {
        writeFileSync(`${status}.tmp`, JSON.stringify({ state: 'failed', detail: String(cause) }));
        renameSync(`${status}.tmp`, status);
        throw cause;
      }
    } else {
      const deadline = performance.now() + 125_000;
      const sleeper = new Int32Array(new SharedArrayBuffer(4));
      while (!existsSync(status)) {
        if (performance.now() >= deadline) throw new TestInstallFailed({ detail: `Timed out waiting for shared install: ${shared}` });
        Atomics.wait(sleeper, 0, 0, 25);
      }
    }
    const state = Schema.decodeUnknownSync(InstallState, { onExcessProperty: 'error' })(readFileSync(status, 'utf8'));
    if (state.state === 'failed') throw new TestInstallFailed({ detail: state.detail });
    // Consumers own their manifests and lock files; only the installed dependency
    // tree is shared. Its lifetime ends after both runners have exited.
    const installed = Schema.decodeUnknownSync(Manifest)(readFileSync(join(shared, 'package.json'), 'utf8'));
    const dependenciesSchema = Schema.Record(Schema.String, Schema.String);
    const installedDependencies = Schema.decodeUnknownSync(dependenciesSchema)(installed.dependencies);
    const artifactReference = installedDependencies[artifact.name];
    if (artifactReference === undefined) throw new TestInstallFailed({ detail: 'Shared install omitted the package dependency' });
    const absoluteReference = `file:${artifact.filename}`;
    const fields = Object.fromEntries(dependencyFields.map(name => [name,
      Object.fromEntries(Object.entries(Schema.decodeUnknownSync(dependenciesSchema)(installed[name] ?? {}))
        .map(([dependency, value]) => [dependency, value === artifactReference ? absoluteReference : value])),
    ]));
    writeFileSync(join(directory, 'package.json'), `${JSON.stringify({ ...manifest, ...fields, packageManager: installed.packageManager }, null, 2)}\n`);
    copyFileSync(join(shared, 'pnpm-workspace.yaml'), join(directory, 'pnpm-workspace.yaml'));
    // pnpm saves archive references relative to the installation directory.
    // Preserve their meaning when giving the consumer its own lock and manifest.
    const lock = parseDocument(readFileSync(join(shared, 'pnpm-lock.yaml'), 'utf8'));
    if (lock.errors.length) throw new TestInstallFailed({ detail: 'Invalid shared installation lock file' });
    visit(lock, { Scalar(_key, node) {
      if (typeof node.value === 'string') node.value = node.value.replaceAll(artifactReference, absoluteReference);
    } });
    writeFileSync(join(directory, 'pnpm-lock.yaml'), lock.toString());
    const modules = join(directory, 'node_modules');
    mkdirSync(modules);
    for (const entry of readdirSync(join(shared, 'node_modules'), { withFileTypes: true })) {
      const from = join(shared, 'node_modules', entry.name), to = join(modules, entry.name);
      // Runner caches such as node_modules/.vite stay in the consumer. Only
      // package contents and pnpm's dependency graph refer to the shared install.
      if (entry.name === '.bin' || entry.isFile()) cpSync(from, to, { recursive: true });
      else if (entry.name.startsWith('@') && entry.isDirectory()) {
        mkdirSync(to);
        for (const name of readdirSync(from)) symlinkSync(join(from, name), join(to, name), 'dir');
      } else symlinkSync(from, to, 'dir');
    }
  }));
}
