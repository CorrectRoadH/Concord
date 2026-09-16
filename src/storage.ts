// @concord-file local-repository-storage
// @concord-implements docs/feature/local-sdlc/use-case/recover-local-state.md
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
// @concord-implements docs/feature/project-onboarding/use-case/initialize-project.md
// @concord-implements docs/feature/project-onboarding/use-case/configure-memory-sources.md
// @concord-implements docs/feature/project-onboarding/use-case/inherit-template-defaults.md
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, rmdirSync, statfsSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Predicate, Schema } from 'effect';
import { acquireTraceLeaseSync, CoordinationError, genericPrivateDirectorySync, releaseTraceLeaseSync, tracePrivateDirectorySync, type TraceLease } from './coordination.js';
import { ConcordError, ProjectSchema, Text, canonical, decode, digest, type Change, type ConfigSnapshot, type MemorySource, type MutationReceipt, type ProjectConfig, type Repository } from './shared.js';
import { renderTypeScriptConfig, snapshot } from './config.js';
import { initialConstitutionSource } from './constitution.js';
import { onboardingGuide } from './onboarding-guide.js';
import { projectTemplateFiles, templateBody } from './templates.js';

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_TRANSACTION_BYTES = 64 * 1024 * 1024;
const LOCAL_LINUX_FS = new Set([0xef53, 0x58465342, 0x9123683e, 0x1021994, 0x2fc12fc1, 0x794c7630, 0xf2f52010, 0x858458f6]);
const errno = (error: unknown, code: string) => error instanceof Error && 'code' in error && error.code === code;
function storageCoordinationFailure(cause: unknown): ConcordError {
  const coordination = cause instanceof CoordinationError || (typeof cause === 'object' && cause !== null && '_tag' in cause && cause._tag === 'CoordinationError');
  if (!coordination) return cause instanceof ConcordError ? cause : new ConcordError('CoordinationFailed', cause instanceof Error ? cause.message : String(cause));
  const error = cause as CoordinationError;
  if (error.phase === 'lock' && error.message.includes('busy')) return new ConcordError('RepositoryBusy', error.message, { operation: error.operation, path: error.path });
  return new ConcordError('CoordinationFailed', error.message, { operation: error.operation, phase: error.phase, path: error.path });
}
export function git(root: string, args: readonly string[]): string {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  try { return execFileSync('git', ['-C', root, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_BYTES, timeout: 10000 }).trimEnd(); }
  catch { throw new ConcordError('GitFailed', `Git could not ${args[0] ?? 'inspect'} the selected repository`); }
}
function present(path: string): boolean { try { lstatSync(path); return true; } catch (cause) { if (errno(cause, 'ENOENT')) return false; throw cause; } }
function assertNoSymlink(path: string): void {
  const absolute = resolve(path);
  let part: string = sep;
  for (const segment of absolute.slice(sep.length).split(sep)) {
    part = join(part, segment);
    if (present(part) && lstatSync(part).isSymbolicLink()) throw new ConcordError('UnsafePath', `Symbolic links are not permitted: ${part}`);
  }
}
export function canonicalPath(path: string): string {
  if (!path || path.trim() !== path || isAbsolute(path) || /[\\\0\r\n]/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..') || path.includes('#')) throw new ConcordError('UnsafePath', `Expected a canonical repository-relative file path: ${path}`);
  return path;
}
function jsonFile<A>(path: string, schema: Schema.ConstraintDecoder<A, never>): A {
  assertNoSymlink(path);
  let value: unknown;
  try { const s = lstatSync(path); if (!s.isFile() || s.size > MAX_TRANSACTION_BYTES) throw new Error('file is not regular or exceeds size limit'); value = JSON.parse(readFileSync(path, 'utf8')); }
  catch (cause) { throw new ConcordError('InvalidData', `Cannot decode ${path}: ${cause instanceof Error ? cause.message : String(cause)}`); }
  return decode(schema, value, path);
}
function syncDirectory(path: string): void { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
function atomic(path: string, contents: string, mode = 0o600): void {
  assertNoSymlink(dirname(path));
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temp, 'wx', mode); writeFileSync(fd, contents); fsyncSync(fd); closeSync(fd); fd = undefined;
    assertNoSymlink(path); renameSync(temp, path); syncDirectory(dirname(path));
  } finally { if (fd !== undefined) closeSync(fd); if (present(temp)) rmSync(temp); }
}
const LockSchema = Schema.Struct({ format: Schema.Literal('concord.lock/v1'), root: Text, host: Text, pid: Schema.Int, token: Text });
const JournalChangeSchema = Schema.Struct({ path: Text, before: Schema.NullOr(Schema.String), after: Schema.NullOr(Schema.String), beforeDigest: Schema.NullOr(Text), afterDigest: Schema.NullOr(Text), mode: Schema.Int });
const JournalScopeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('documents'), configPath: Schema.Literal('concord.config.ts'), configSource: Schema.String, configDigest: Text }),
  Schema.Struct({ kind: Schema.Literal('source'), configPath: Schema.Literal('concord.config.ts'), configSource: Schema.String, configDigest: Text }),
]);
const JournalSchema = Schema.Struct({
  format: Schema.Literal('concord.journal'), root: Text, privateDir: Text, projectId: Text, operation: Text,
  phase: Schema.Literals(['prepared', 'committed']), directories: Schema.Array(Text), changes: Schema.Array(JournalChangeSchema), scope: JournalScopeSchema,
});
type Journal = typeof JournalSchema.Type;

function currentJournal(path: string): Journal {
  const value = jsonFile(path, Schema.Unknown);
  if (Predicate.isObject(value) && value.format === 'concord.journal') {
    const scope = Predicate.isObject(value.scope) ? value.scope : undefined;
    const unbound = scope !== undefined && (scope.kind === 'documents' || scope.kind === 'source') && scope.configPath === undefined && scope.configSource === undefined && scope.configDigest === undefined;
    const historicalSource = scope?.kind === 'source' && scope.configPath === undefined && typeof scope.configSource === 'string' && typeof scope.configDigest === 'string' && scope.configDigest === digest(scope.configSource) && scope.configSource.trimStart().startsWith('{');
    const oldOwner = Array.isArray(value.changes) && value.changes.some((change: unknown) => Predicate.isObject(change) && change.path === 'concord.json');
    if (unbound || historicalSource || scope?.configPath === 'concord.json' || oldOwner) throw new ConcordError('JournalMigrationRequired', 'Historical journal requires explicit offline recovery before configuration migration; preserve the journal, locks, and files. Ordinary recover cannot process it.');
  }
  return decode(JournalSchema, value, path);
}

/** Refusal only: callers must still acquire a lease and repeat this check before ordinary work. */
export function assertCurrentRuntimeFormat(root: string): void {
  const journal = join(genericPrivateDirectorySync(root), 'journal.json');
  if (present(journal)) currentJournal(journal);
  if (present(join(root, 'concord.json'))) throw new ConcordError('ProjectMigrationRequired', 'concord.json is not a runtime configuration; explicitly migrate it to concord.config.ts offline. Preserve any interrupted journals and locks for offline recovery first.');
}

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/u;
const forbiddenSourcePart = (path: string): boolean => path.split('/').some(part => part === '.git' || part === 'node_modules');

export function discoverRoot(input?: string, initialize = false): string {
  let cursor = resolve(input ?? process.cwd());
  assertNoSymlink(cursor);
  if (initialize || input !== undefined) return cursor;
  for (;;) {
    if (present(join(cursor, 'concord.config.ts')) || present(join(cursor, 'concord.json'))) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) throw new ConcordError('ProjectNotFound', 'No Concord project configuration was found; run concord init in a Git worktree root');
    cursor = parent;
  }
}
function defaultConfig(): ProjectConfig {
  return {
    format: 'concord.project/v1', projectId: randomUUID(), testRoots: ['test', 'tests'], sourceRoots: [],
    runner: { kind: 'node-test', sourceFiles: [], timeoutMs: 60000 }, projectTypes: [],
    documentDefaults: { featurePages: [], roadmapPages: [], designPages: [] },
    constitution: { path: 'docs/constitution.md' },
    memorySources: [{ name: 'project', provider: 'local-files', path: 'memory', access: 'read-write', defaultWrite: true }],
  };
}
const fixedOwner = (path: string): boolean => path === 'concord.config.ts' || path === 'DESIGN.md' || path === 'docs/README.md' || path === 'docs/concord.md' || path === 'docs/concepts.md' || path === 'docs/architecture.md' || path === 'docs/constitution.md' || /^(?:docs\/(?:_template|feature|roadmap|design|research|engineering|issues)\/).+\.md$/.test(path);

export class LocalRepository implements Repository {
  readonly root: string;
  readonly privateDir: string;
  config: ProjectConfig;
  configSnapshot: ConfigSnapshot;
  private lockToken: string | undefined;
  private traceLease: TraceLease | undefined;
  private readonly noWrite: boolean;
  constructor(input?: string, options: { initialize?: boolean; recover?: boolean; dryRun?: boolean } = {}) {
    this.root = discoverRoot(input, options.initialize);
    this.noWrite = options.dryRun ?? false;
    if (options.recover && this.noWrite) throw new ConcordError('InvalidOption', 'recover does not accept --dry-run');
    if (process.platform !== 'linux') throw new ConcordError('UnsupportedHost', 'Concord currently supports local Linux filesystems');
    if (git(this.root, ['rev-parse', '--show-toplevel']) !== this.root) throw new ConcordError('ProjectRootInvalid', 'The project must be the Git worktree top-level directory');
    if (!LOCAL_LINUX_FS.has(statfsSync(this.root).type)) throw new ConcordError('UnsupportedFilesystem', 'Concord requires a supported local filesystem');
    assertCurrentRuntimeFormat(this.root);
    try { this.privateDir = genericPrivateDirectorySync(this.root); }
    catch (cause) { throw storageCoordinationFailure(cause); }
    assertNoSymlink(this.privateDir);
    if (!LOCAL_LINUX_FS.has(statfsSync(dirname(this.privateDir)).type)) throw new ConcordError('UnsupportedFilesystem', 'Concord private state requires a local filesystem');
    try {
      const coordinationDir = tracePrivateDirectorySync(this.root);
      // Only a new owner-free, lock-free repository may preview without creating private state.
      const emptyPreview = options.initialize === true && this.noWrite
        && !['concord.config.ts', 'concord.json', 'docs', 'memory', 'DESIGN.md'].some(path => present(this.absolute(path)))
        && ![join(this.privateDir, 'lock.json'), join(this.privateDir, 'journal.json'), join(coordinationDir, 'publication.lock'), join(coordinationDir, 'publication-journal.json'), join(coordinationDir, 'multi-file-publication-journal.json')].some(present);
      try { this.traceLease = acquireTraceLeaseSync(this.root, this.noWrite ? 'shared' : 'exclusive', options.recover ? 'recover' : 'repository', !emptyPreview); }
      catch (cause) { throw storageCoordinationFailure(cause); }
      assertCurrentRuntimeFormat(this.root);
      const traceDir = coordinationDir;
      const traceJournal = traceDir === undefined ? undefined : join(traceDir, 'publication-journal.json');
      const traceMultiJournal = traceDir === undefined ? undefined : join(traceDir, 'multi-file-publication-journal.json');
      const pendingTraceJournal = traceJournal !== undefined && present(traceJournal) ? traceJournal : traceMultiJournal !== undefined && present(traceMultiJournal) ? traceMultiJournal : undefined;
      if (pendingTraceJournal !== undefined) {
        throw new ConcordError('RecoveryRequired', `An interrupted Trace publication exists; run trace recover (${pendingTraceJournal})`);
      }
      const genericJournal = join(this.privateDir, 'journal.json');
      assertNoSymlink(genericJournal);
      if (present(genericJournal) && !options.recover) throw new ConcordError('RecoveryRequired', 'An interrupted publication exists; run concord recover');
      const marker = this.read('concord.config.ts');
      const markerPath = 'concord.config.ts';
      const recoveryJournal = options.recover && present(genericJournal) ? currentJournal(genericJournal) : undefined;
      if (options.recover && marker === undefined && (recoveryJournal?.operation !== 'init' || recoveryJournal.phase !== 'prepared')) throw new ConcordError('RecoveryConflict', 'Missing TS configuration may only be recovered from a current prepared init journal');
      if (options.initialize && marker !== undefined) throw new ConcordError('ProjectExists', `${markerPath} already exists`);
      if (!options.initialize && marker === undefined && !options.recover) throw new ConcordError('ProjectNotFound', 'The selected worktree has no Concord project configuration; run concord init');
      this.configSnapshot = marker === undefined ? { path: 'concord.config.ts', source: '', digest: digest(''), config: defaultConfig() } : snapshot(markerPath, marker);
      this.config = this.configSnapshot.config;
      this.validateConfiguredRoots(this.config);
      for (const path of [...this.config.testRoots, ...(this.config.sourceRoots ?? []), ...this.config.runner.sourceFiles]) this.absolute(path);
      this.validateMemorySources(this.config);
      if (recoveryJournal !== undefined) this.preflight(recoveryJournal, true);
      if (options.recover) this.removeDeadLock();
      if (!this.noWrite) this.acquire();
      else if (present(join(this.privateDir, 'lock.json'))) throw new ConcordError('RepositoryBusy', 'A Concord operation is active; retry when it completes');
    } catch (cause) { this.close(); throw cause; }
  }
  absolute(path: string): string {
    canonicalPath(path);
    const target = resolve(this.root, path);
    if (!target.startsWith(`${this.root}${sep}`)) throw new ConcordError('UnsafePath', path);
    assertNoSymlink(target);
    return target;
  }
  read(path: string): string | undefined {
    const target = this.absolute(path);
    if (!present(target)) return undefined;
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new ConcordError('InvalidFile', `${path} must be a regular file of at most ${MAX_BYTES} bytes`);
    return readFileSync(target, 'utf8');
  }
  files(prefix: string): string[] {
    const base = this.absolute(prefix);
    if (!present(base)) return [];
    const paths: string[] = [];
    const walk = (path: string) => {
      assertNoSymlink(path);
      const stat = lstatSync(path);
      if (stat.isFile()) { paths.push(relative(this.root, path).split(sep).join('/')); return; }
      if (!stat.isDirectory()) throw new ConcordError('InvalidFile', `Unsupported file type: ${path}`);
      for (const name of readdirSync(path).sort()) { if (name === '.git' || name === 'node_modules') continue; walk(join(path, name)); }
    };
    walk(base); return paths;
  }
  private sourcePath(path: string, roots: readonly string[]): void {
    canonicalPath(path);
    if (!SOURCE_EXTENSION.test(path) || forbiddenSourcePart(path)) throw new ConcordError('InvalidSourcePath', `Source must be a JavaScript or TypeScript file in a configured source root: ${path}`);
    if (roots.length === 0 || !roots.some(root => path === root || path.startsWith(`${root}/`))) throw new ConcordError('InvalidSourcePath', `Source is outside configured sourceRoots or testRoots: ${path}`);
    this.absolute(path);
  }
  private sourceScopeRoots(config: ProjectConfig): readonly string[] {
    const roots = [...config.testRoots, ...(config.sourceRoots ?? [])];
    const unique = [...new Set(roots)].sort();
    if (unique.length === 0) throw new ConcordError('InvalidSourcePath', 'source.set requires at least one configured sourceRoot or testRoot');
    for (const root of unique) this.validateConfiguredRoot(root);
    return unique;
  }
  private validateConfiguredRoots(config: ProjectConfig): void {
    for (const root of [...config.testRoots, ...(config.sourceRoots ?? [])]) this.validateConfiguredRoot(root);
  }
  private validateMemorySources(config: ProjectConfig): void {
    const sources = config.memorySources ?? [{ name: 'project', provider: 'local-files' as const, path: 'memory', access: 'read-write' as const, defaultWrite: true }];
    if (new Set(sources.map((source) => source.name)).size !== sources.length) throw new ConcordError('InvalidMemorySources', 'Memory source names must be unique');
    if (new Set(sources.map((source) => source.path)).size !== sources.length) throw new ConcordError('InvalidMemorySources', 'Memory source canonical paths must be unique');
    const defaults = sources.filter((source) => source.defaultWrite === true);
    if (defaults.length !== 1 || defaults[0]?.access !== 'read-write') throw new ConcordError('InvalidMemorySources', 'Exactly one writable Memory source must be the default write target');
    const reserved = ['docs', '.git', ...config.testRoots, ...(config.sourceRoots ?? [])];
    for (const source of sources) {
      canonicalPath(source.path); this.absolute(source.path);
      if (forbiddenSourcePart(source.path)) throw new ConcordError('InvalidMemorySources', `Unsafe Memory source path: ${source.path}`);
      if ([...reserved, ...sources.filter((other) => other !== source).map((other) => other.path)].some((root) => source.path === root || source.path.startsWith(`${root}/`) || root.startsWith(`${source.path}/`))) {
        throw new ConcordError('InvalidMemorySources', `Memory source ${source.path} overlaps a managed, source, test, or private root`);
      }
    }
  }
  private validateProjectConfig(config: ProjectConfig): void {
    this.validateConfiguredRoots(config);
    for (const path of config.runner.sourceFiles) this.absolute(path);
    this.validateMemorySources(config);
  }
  private memorySource(path: string, config: ProjectConfig = this.config): MemorySource | undefined {
    return (config.memorySources ?? [{ name: 'project', provider: 'local-files' as const, path: 'memory', access: 'read-write' as const, defaultWrite: true }])
      .find((source) => path === source.path || path.startsWith(`${source.path}/`));
  }
  private allowedOwner(path: string, config: ProjectConfig = this.config): boolean { return fixedOwner(path) || (path.endsWith('.md') && this.memorySource(path, config) !== undefined); }
  private assertWritable(path: string, config: ProjectConfig = this.config): void {
    const source = this.memorySource(path, config);
    if (source?.access === 'read-only') throw new ConcordError('ReadOnlyMemorySource', `Memory source ${source.name} is read-only: ${path}`);
  }
  private currentSnapshot(): ConfigSnapshot {
    if (present(join(this.root, 'concord.json'))) throw new ConcordError('ProjectMigrationRequired', 'Old project configuration appeared; explicit offline migration is required');
    const source = this.read('concord.config.ts');
    if (source === undefined) throw new ConcordError('ProjectNotFound', 'Project configuration disappeared');
    return snapshot('concord.config.ts', source);
  }
  private validateConfiguredRoot(root: string): void {
      canonicalPath(root);
      if (forbiddenSourcePart(root)) throw new ConcordError('InvalidSourcePath', `Unsafe sourceRoot: ${root}`);
      this.absolute(root);
  }
  private acquire(): void {
    assertNoSymlink(this.privateDir); mkdirSync(this.privateDir, { recursive: true, mode: 0o700 });
    const path = join(this.privateDir, 'lock.json');
    const token = randomUUID(); let fd: number;
    try { fd = openSync(path, 'wx', 0o600); }
    catch (cause) { if (errno(cause, 'EEXIST')) throw new ConcordError('RepositoryBusy', 'Another operation or abandoned lock exists; use recover only after the owner exits'); throw cause; }
    try { writeFileSync(fd, canonical({ format: 'concord.lock/v1', root: this.root, host: hostname(), pid: process.pid, token })); fsyncSync(fd); this.lockToken = token; }
    finally { closeSync(fd); }
  }
  private removeDeadLock(): void {
    const path = join(this.privateDir, 'lock.json');
    if (!present(path)) return;
    assertNoSymlink(path);
    const source = readFileSync(path, 'utf8');
    const lock = jsonFile(path, LockSchema);
    if (lock.root !== this.root || lock.host !== hostname() || lock.pid <= 0) throw new ConcordError('RecoveryConflict', 'The lock owner cannot be safely identified');
    try { process.kill(lock.pid, 0); throw new ConcordError('RepositoryBusy', 'The lock owner is still alive'); }
    catch (cause) { if (!errno(cause, 'ESRCH')) throw cause; }
    if (readFileSync(path, 'utf8') !== source) throw new ConcordError('RecoveryConflict', 'The lock changed during recovery');
    rmSync(path);
  }
  close(): void {
    try {
      if (this.lockToken !== undefined) {
        const path = join(this.privateDir, 'lock.json');
        try { const lock = jsonFile(path, LockSchema); if (lock.token === this.lockToken) rmSync(path); }
        finally { this.lockToken = undefined; }
      }
    } finally {
      if (this.traceLease !== undefined) {
        const lease = this.traceLease;
        this.traceLease = undefined;
        releaseTraceLeaseSync(lease, 'repository-close');
      }
    }
  }
  // @concord-code publish-guarded-documents
  // @concord-implements docs/feature/local-sdlc/use-case/recover-local-state.md
  publish(operation: string, changes: readonly Change[], dryRun = false): MutationReceipt {
    if (changes.length === 0) return { operation, dryRun, changedPaths: [] };
    if (new Set(changes.map(c => c.path)).size !== changes.length) throw new ConcordError('InvalidChange', 'A path occurs more than once in the publication');
    const configChanges = changes.filter((change) => change.path === 'concord.config.ts');
    if (configChanges.length > 1) throw new ConcordError('InvalidChange', 'A publication may contain only one project configuration change');
    const plannedConfigChange = configChanges[0];
    if (plannedConfigChange?.after === null) throw new ConcordError('InvalidChange', 'The runtime configuration cannot be deleted or renamed');
    if (operation === 'set-config' && changes.length !== 1) throw new ConcordError('InvalidChange', 'config.set must publish exactly one configuration');
    if (operation === 'init' && plannedConfigChange === undefined) throw new ConcordError('InvalidChange', 'Init must publish exactly one project configuration');
    const authorizationConfig = plannedConfigChange?.after === null || plannedConfigChange?.after === undefined ? this.config : snapshot(plannedConfigChange.path as ConfigSnapshot['path'], plannedConfigChange.after).config;
    if (plannedConfigChange?.after !== null && plannedConfigChange?.after !== undefined) this.validateProjectConfig(authorizationConfig);
    const entries = changes.map(c => {
      this.absolute(c.path);
      if (!this.allowedOwner(c.path, authorizationConfig)) throw new ConcordError('InvalidChange', `Not a Concord document owner: ${c.path}`);
      this.assertWritable(c.path, authorizationConfig);
      const current = this.read(c.path) ?? null;
      if (current !== c.before) throw new ConcordError('PreimageChanged', `${c.path} changed; read its current digest and retry`);
      if (c.before === null && c.after === null) throw new ConcordError('InvalidChange', 'An empty change is not permitted');
      return { ...c, beforeDigest: c.before === null ? null : digest(c.before), afterDigest: c.after === null ? null : digest(c.after), mode: current === null ? 0o644 : lstatSync(this.absolute(c.path)).mode & 0o777 };
    });
    const directories = new Set<string>();
    for (const c of entries) { let dir = dirname(c.path); while (dir !== '.') { if (!present(this.absolute(dir))) directories.add(dir); dir = dirname(dir); } }
    const isInit = operation === 'init' && this.configSnapshot.source === '';
    const journal: Journal = { format: 'concord.journal', root: this.root, privateDir: this.privateDir, projectId: authorizationConfig.projectId, operation, phase: 'prepared', directories: [...directories].sort((a,b) => a.length - b.length), changes: entries, scope: isInit ? { kind: 'documents', configPath: 'concord.config.ts', configSource: '', configDigest: digest('') } : { kind: 'documents', configPath: this.configSnapshot.path, configSource: this.configSnapshot.source, configDigest: this.configSnapshot.digest } };
    const receipt = this.publishJournal(journal, dryRun);
    if (operation === 'init' && !receipt.dryRun && plannedConfigChange?.after !== null && plannedConfigChange?.after !== undefined) {
      this.configSnapshot = snapshot(plannedConfigChange.path as ConfigSnapshot['path'], plannedConfigChange.after);
      this.config = this.configSnapshot.config;
    }
    return receipt;
  }
  /** Publishes one existing configured JS/TS file using the unified source-set journal. */
  publishSource(path: string, before: string, after: string, dryRun = false): MutationReceipt {
    const frozen = this.currentSnapshot();
    const configSource = frozen.source;
    const config = frozen.config;
    if (config.projectId !== this.config.projectId) throw new ConcordError('PreimageChanged', 'Project identity changed before source publication');
    const roots = this.sourceScopeRoots(config);
    this.sourcePath(path, roots);
    const target = this.absolute(path);
    const stat = lstatSync(target);
    if (!stat.isFile()) throw new ConcordError('InvalidSourcePath', `Source must be an existing regular file: ${path}`);
    const current = this.read(path);
    if (current === undefined || current !== before) throw new ConcordError('PreimageChanged', `${path} changed; read its current digest and retry`);
    if (after === before) return { operation: 'set-source', dryRun: dryRun || this.noWrite, changedPaths: [] };
    const change = { path, before, after, beforeDigest: digest(before), afterDigest: digest(after), mode: stat.mode & 0o777 };
    const journal: Journal = {
      format: 'concord.journal', root: this.root, privateDir: this.privateDir, projectId: config.projectId,
      operation: 'set-source', phase: 'prepared', directories: [], changes: [change],
      scope: { kind: 'source', configPath: frozen.path, configSource, configDigest: frozen.digest },
    };
    return this.publishJournal(journal, dryRun);
  }
  private publishJournal(journal: Journal, dryRun: boolean): MutationReceipt {
    if (Buffer.byteLength(canonical(journal)) > MAX_TRANSACTION_BYTES) throw new ConcordError('InvalidChange', 'Publication exceeds the transaction size limit');
    const changedPaths = journal.changes.map(change => change.path);
    // Validate the complete set before persisting a prepared journal; dry-run follows this same guard.
    this.preflight(journal);
    if (dryRun || this.noWrite) return { operation: journal.operation, dryRun: true, changedPaths };
    if (this.lockToken === undefined) throw new ConcordError('RepositoryBusy', 'Publication requires an owned lock');
    const journalPath = join(this.privateDir, 'journal.json');
    if (present(journalPath)) throw new ConcordError('RecoveryRequired', 'Run concord recover before another publication');
    atomic(journalPath, `${canonical(journal)}\n`);
    try {
      this.preflight(journal);
      for (const dir of journal.directories) { const target = this.absolute(dir); mkdirSync(target, { recursive: true }); syncDirectory(dirname(target)); }
      for (const change of journal.changes) {
        if (journal.scope.kind === 'source') {
          const current = this.currentSnapshot();
          if (current.path !== journal.scope.configPath || current.digest !== journal.scope.configDigest) throw new ConcordError('PreimageChanged', 'Project configuration changed before source replacement');
        }
        if ((this.read(change.path) ?? null) !== change.before) throw new ConcordError('PreimageChanged', `${change.path} changed before replacement`);
        this.apply(change.path, change.after, change.mode);
      }
      atomic(journalPath, `${canonical({ ...journal, phase: 'committed' })}\n`);
    } catch (cause) {
      throw new ConcordError('RecoveryRequired', `Publication stopped: ${cause instanceof Error ? cause.message : String(cause)}; run concord recover`);
    }
    try { rmSync(journalPath); syncDirectory(this.privateDir); }
    catch { return { operation: journal.operation, dryRun: false, changedPaths, recoveryRequired: true }; }
    return { operation: journal.operation, dryRun: false, changedPaths };
  }
  private preflight(journal: Journal, recovering = false): void {
    const fail = (message: string): never => { throw new ConcordError(recovering ? 'RecoveryConflict' : 'PreimageChanged', message); };
    if (journal.root !== this.root || journal.privateDir !== this.privateDir) fail('Publication belongs to a different worktree');
    if (new Set(journal.changes.map(change => change.path)).size !== journal.changes.length || journal.changes.length === 0) fail('Journal must contain unique changes');
    if (new Set(journal.directories).size !== journal.directories.length) fail('Journal contains duplicate directories');
    if (journal.scope.kind === 'source') {
      if (journal.operation !== 'set-source' || journal.changes.length !== 1 || journal.directories.length !== 0) fail('Source publication must replace exactly one existing file without directories');
      if (digest(journal.scope.configSource) !== journal.scope.configDigest) fail('Frozen project configuration digest is invalid');
      const frozenPath = journal.scope.configPath;
      const current = this.currentSnapshot();
      if (current.path !== frozenPath || current.digest !== journal.scope.configDigest) fail('Project configuration changed since source publication');
      const config = snapshot(frozenPath, journal.scope.configSource).config;
      if (config.projectId !== journal.projectId || config.projectId !== this.config.projectId) fail('Project identity changed');
      const change = journal.changes[0]!;
      const roots = this.sourceScopeRoots(config);
      this.sourcePath(change.path, roots);
      if (change.before === null || change.after === null || change.before === change.after) fail('Source journal requires distinct non-null before and after bytes');
      const stat = lstatSync(this.absolute(change.path));
      if (!stat.isFile() || (stat.mode & 0o777) !== change.mode) fail(`${change.path} type or mode changed`);
    } else {
      const configChanges = journal.changes.filter((change) => change.path === 'concord.config.ts');
      if (configChanges.length > 1) fail('Journal contains multiple project configuration changes');
      const plannedConfigChange = configChanges[0];
      let authorizationConfig: ProjectConfig | undefined;
      {
        if (digest(journal.scope.configSource) !== journal.scope.configDigest) fail('Frozen project configuration digest is invalid');
        if (journal.operation === 'init') {
          if (journal.scope.configSource !== '' || journal.scope.configPath !== 'concord.config.ts' || plannedConfigChange?.path !== 'concord.config.ts' || plannedConfigChange.before !== null || plannedConfigChange.after === null || plannedConfigChange.after === undefined) fail('Init journal does not bind one new static configuration');
          const plannedSource = plannedConfigChange?.after;
          if (typeof plannedSource !== 'string') fail('Init journal configuration is missing');
          const typed = this.read('concord.config.ts');
          if (!recovering && typed !== undefined) fail('Project configuration appeared since init planning');
          authorizationConfig = snapshot('concord.config.ts', plannedSource as string).config;
          this.validateProjectConfig(authorizationConfig);
          if (authorizationConfig.projectId !== journal.projectId) fail('Project identity changed');
        } else {
          authorizationConfig = snapshot(journal.scope.configPath as ConfigSnapshot['path'], journal.scope.configSource).config;
          this.validateProjectConfig(authorizationConfig);
          if (authorizationConfig.projectId !== journal.projectId) fail('Project identity changed');
          const current = this.currentSnapshot();
          const recoveringPlannedConfig = recovering && plannedConfigChange?.path === journal.scope.configPath && plannedConfigChange.after !== null && current.source === plannedConfigChange.after;
          if (current.path !== journal.scope.configPath || current.source !== journal.scope.configSource && !recoveringPlannedConfig) fail('Project configuration changed since publication planning');
        }
      }
      if (plannedConfigChange?.after !== null && plannedConfigChange?.after !== undefined) {
        const next = snapshot(plannedConfigChange.path as ConfigSnapshot['path'], plannedConfigChange.after).config;
        this.validateProjectConfig(next);
        if (next.projectId !== journal.projectId) fail('Planned configuration changes project identity');
      }
      if (plannedConfigChange?.after === null) fail('A journal cannot delete the runtime configuration');
      if (authorizationConfig === undefined) fail('Missing current TS authorization');
      for (const change of journal.changes) if (!this.allowedOwner(change.path, authorizationConfig)) fail(`Not a Concord document owner: ${change.path}`);
      for (const dir of journal.directories) {
        this.absolute(dir);
        if (!journal.changes.some(change => change.path.startsWith(`${dir}/`))) fail('Journal contains an unrelated directory');
      }
    }
    for (const change of journal.changes) {
      this.absolute(change.path);
      if (change.mode < 0 || change.mode > 0o777 || (change.before === null ? null : digest(change.before)) !== change.beforeDigest || (change.after === null ? null : digest(change.after)) !== change.afterDigest) fail('Invalid journal contents');
      const current = this.read(change.path) ?? null;
      if (!recovering) {
        if (current !== change.before) fail(`${change.path} changed before publication`);
      } else if (journal.phase === 'committed' ? current !== change.after : current !== change.before && current !== change.after) {
        fail(`${change.path} has an external edit; preserve it and resolve the conflict before recovery`);
      }
    }
  }
  private apply(path: string, contents: string | null, mode: number): void {
    const target = this.absolute(path);
    if (contents === null) { if (present(target)) { rmSync(target); syncDirectory(dirname(target)); } }
    else atomic(target, contents, mode);
  }
  // @concord-code recover-document-publication
  // @concord-implements docs/feature/local-sdlc/use-case/recover-local-state.md
  recover(): { operation: string; status: string; changedPaths: readonly string[] } {
    const path = join(this.privateDir, 'journal.json');
    if (!present(path)) return { operation: 'recover', status: 'clean', changedPaths: [] };
    const journal = currentJournal(path);
    this.preflight(journal, true);
    if (journal.phase === 'prepared') {
      for (const change of [...journal.changes].reverse()) {
        if (journal.scope.kind === 'source') {
          const current = this.currentSnapshot();
          if (current.path !== journal.scope.configPath || current.digest !== journal.scope.configDigest) throw new ConcordError('RecoveryConflict', 'Project configuration changed during source recovery');
        }
        const current = this.read(change.path) ?? null;
        if (current !== change.before && current !== change.after) throw new ConcordError('RecoveryConflict', `${change.path} changed during recovery`);
        if (current !== change.before) this.apply(change.path, change.before, change.mode);
      }
      for (const dir of [...journal.directories].sort((a,b) => b.length - a.length)) {
        const target = this.absolute(dir);
        if (present(target)) { try { rmdirSync(target); } catch (cause) { if (!errno(cause, 'ENOTEMPTY')) throw cause; } }
      }
    }
    rmSync(path); syncDirectory(this.privateDir);
    return { operation: 'recover', status: journal.phase === 'prepared' ? 'rolled-back' : 'committed', changedPaths: journal.changes.map(c => c.path) };
  }
}

export interface InitializeOptions { readonly projectId?: string; readonly testRoots?: readonly string[]; readonly sourceRoots?: readonly string[]; readonly runner?: ProjectConfig['runner']; readonly projectTypes?: readonly ('library' | 'cli')[]; readonly pages?: readonly ('library' | 'cli' | 'architecture' | 'lifecycle' | 'use-case')[]; readonly design?: boolean; readonly constitutionBody?: string; readonly adoptConstitution?: boolean; readonly constitutionReason?: string; readonly constitutionImpact?: string; readonly constitutionSources?: readonly string[]; readonly memorySources?: ProjectConfig['memorySources'] }
export interface InitializationReceipt extends MutationReceipt { readonly config: ProjectConfig; readonly createdPaths: readonly string[]; readonly preservedPaths: readonly string[] }
// @concord-code initialize-project-documents
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md
export function initialize(repo: Repository, dryRun = false, options: InitializeOptions = {}): InitializationReceipt {
  const projectTypes = [...(options.projectTypes ?? [])];
  const inferredPages = options.pages ?? [...new Set(projectTypes.flatMap((type) => type === 'library' ? ['library', 'architecture'] as const : ['cli', 'architecture'] as const))];
  const config = decode(ProjectSchema, { ...repo.config, ...(options.projectId ? { projectId: options.projectId } : {}), ...(options.testRoots ? { testRoots: options.testRoots } : {}), ...(options.sourceRoots ? { sourceRoots: options.sourceRoots } : {}), ...(options.runner ? { runner: options.runner } : {}), projectTypes, documentDefaults: { featurePages: inferredPages, roadmapPages: inferredPages, designPages: inferredPages }, constitution: { path: 'docs/constitution.md' }, ...(options.memorySources ? { memorySources: options.memorySources } : {}) }, 'init configuration');
  for (const root of [...config.testRoots, ...(config.sourceRoots ?? [])]) {
    canonicalPath(root);
    if (forbiddenSourcePart(root)) throw new ConcordError('InvalidSourcePath', `Unsafe sourceRoot or testRoot: ${root}`);
    repo.absolute(root);
  }
  for (const path of config.runner.sourceFiles) repo.absolute(path);
  for (const source of config.memorySources ?? []) if (source.access === 'read-only' && !existsSync(repo.absolute(source.path))) throw new ConcordError('MemorySourceUnavailable', `Read-only Memory source must already exist: ${source.path}`);
  const active = options.adoptConstitution === true;
  const constitution = initialConstitutionSource({ body: options.constitutionBody ?? templateBody('constitution', 'Project'), active, reason: options.constitutionReason, impact: options.constitutionImpact, sources: options.constitutionSources });
  const paths: Record<string, string> = { 'concord.config.ts': renderTypeScriptConfig(config), 'docs/constitution.md': constitution, 'docs/concord.md': onboardingGuide, ...projectTemplateFiles() };
  if (options.design === true) paths['DESIGN.md'] = templateBody('project-design', 'Project');
  const preservedPaths: string[] = [];
  for (const [path, name] of [['docs/README.md', 'project-index'], ['docs/concepts.md', 'concepts'], ['docs/architecture.md', 'project-architecture']] as const) {
    if (repo.read(path) === undefined) paths[path] = templateBody(name, 'Project');
    else preservedPaths.push(path);
  }
  const sections: Record<string, [string, string, string]> = {
    'docs/feature/README.md': ['Features', 'Adopted product contracts. Write the target behavior and link complete user paths.', 'feature create'],
    'docs/roadmap/README.md': ['Roadmap', 'Settled directions awaiting adoption as current Feature contracts.', 'roadmap create'],
    'docs/design/README.md': ['Design decisions', 'Compare self-contained candidates against shared goals and constraints. Record selection with design decide.', 'design create'],
    'docs/engineering/README.md': ['Engineering', 'Repository testing and maintenance mechanisms, their usage and acceptance requirements.', 'engineering create'],
    'docs/research/README.md': ['Research', 'Dated external facts and primary sources informing decisions.', 'research create'],
    'docs/issues/README.md': ['Local feedback and observations', 'Editable local feedback, imported source snapshots, and investigation links. Concord reads configured providers only during explicit sync/import and never mutates remote issues.', 'feedback create'],
  };
  for (const source of config.memorySources ?? []) if (source.access === 'read-write') sections[`${source.path}/README.md`] = ['Engineering memory', `Memory source ${source.name} (${source.access}).`, 'memory add'];
  for (const [path, [title, description, command]] of Object.entries(sections)) paths[path] = `# ${title}\n\n${description}\n\nStart with \`concord ${command} --help\`.\nUse \`concord ${command.split(' ')[0]} list\` to discover documents.\n`;
  for (const path of Object.keys(paths)) if (repo.read(path) !== undefined) throw new ConcordError('InitializationConflict', `${path} already exists; no existing file will be overwritten`);
  const receipt = repo.publish('init', Object.entries(paths).map(([path, after]) => ({ path, before: null, after })), dryRun);
  return { ...receipt, config, createdPaths: receipt.changedPaths, preservedPaths };
}
