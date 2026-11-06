import { makeRuntimeEnvironment, type RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import { bindRepositoryRuntime } from './repository-runtime.ts';
import { git, discoverRoot, darwinPathCollisionKey, hasExactDarwinEntry, assertNoSymlink } from './bootstrap.ts';
export { git, discoverRoot, darwinPathCollisionKey, hasExactDarwinEntry } from './bootstrap.ts';
import { adapterRuntimeInputs } from '../process/index.ts';
import type { PublicationValidation } from "../publication/index.ts";
import type { StepRename } from "../../model/index.ts";

import { canonicalPath } from "../../model/index.ts";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, rmdirSync, writeFileSync, type BigIntStats } from "node:fs";
import { release } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { Schema } from "effect";
import { acquireTraceLeaseSync, CoordinationError, genericPrivateDirectorySync, recoverPublicationLeaseSync, releaseTraceLeaseSync, tracePrivateDirectorySync, PUBLICATION_LEASE, type TraceLease } from "../publication/index.ts";
import { ConcordError, Text, canonical, decode, digest, isWorkflowSkillPath, isObsoleteWorkflowSkillRemoval, type Change, type ConfigSnapshot, type MutationReceipt, type shared_ProjectConfig as ProjectConfig, type ResolvedProjectConfig, type Repository } from "../../model/index.ts";
import { snapshot, makeConfigContentCache } from "./config.ts";
import { closeRepositoryCache, inheritContentCacheOwner } from "../cache/index.ts";
import { invalidateActiveRun } from "../publication/index.ts";
import { acquireFileLease, acquireRecoverablePublicationLease } from "../publication/index.ts";



import { defaultWritingSource } from "../../model/index.ts";
import { EMPTY_CONCEPT_CATALOG } from "../../model/index.ts";
import { catalogName, policyName, scopeOf } from "../../model/index.ts";
import { excludedSourcePath } from "../../model/index.ts";

// @concord-begin
// @concord-implements docs/feature/portable-coordination/architecture.md#invariants
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_TRANSACTION_BYTES = 64 * 1024 * 1024;
type RootAnchor = { readonly path: string; readonly dev: bigint; readonly ino: bigint };
class ObservationChanged extends ConcordError {
  readonly path: string;
  constructor(path: string) { super('FileChangedSinceRead', `${path} changed after planning; take a fresh snapshot`, 'source-observation'); this.path = path; }
}
const errno = (error: unknown, code: string) => error instanceof Error && 'code' in error && error.code === code;
function storageCoordinationFailure(cause: unknown): ConcordError {
  const coordination = cause instanceof CoordinationError || (typeof cause === 'object' && cause !== null && '_tag' in cause && cause._tag === 'CoordinationError');
  if (!coordination) return cause instanceof ConcordError ? cause : new ConcordError('CoordinationFailed', cause instanceof Error ? cause.message : String(cause));
  const error = cause as CoordinationError;
  if (error.message.includes('busy')) return new ConcordError('RepositoryBusy', error.message, { operation: error.operation, path: error.path });
  return new ConcordError('CoordinationFailed', error.message, { operation: error.operation, phase: error.phase, path: error.path });
}
// @concord-end
// @concord-begin
// @concord-implements docs/feature/local-sdlc/architecture.md#操作依赖
function present(path: string): boolean { try { lstatSync(path); return true; } catch (cause) { if (errno(cause, 'ENOENT')) return false; throw cause; } }

function assertReadHost(): void {
  if (process.platform !== 'linux' && process.platform !== 'darwin') throw new ConcordError('UnsupportedHost', 'Concord supports Linux and Darwin/macOS hosts');
  if (process.platform === 'darwin' && Number(release().split('.')[0]) < 20) throw new ConcordError('UnsupportedHost', 'Concord requires macOS 11 or later for O_NOFOLLOW_ANY');
}

function readCheckedBytes(target: string, path: string, stat: BigIntStats, verifying = false): Buffer {
  if (stat.isSymbolicLink()) throw new ConcordError('UnsafePath', `Symbolic links are not permitted: ${path}`);
  if (!stat.isFile()) throw new ConcordError(verifying ? 'UnsafePath' : 'InvalidFile', `${path} must be a regular file`);
  let fd: number | undefined;
  try {
    fd = openSync(target, constants.O_RDONLY | (process.platform === 'darwin' ? 0x20000000 : constants.O_NOFOLLOW));
    if (process.platform === 'linux') {
      let opened: string;
      try { opened = readlinkSync(`/proc/self/fd/${fd}`); }
      catch { throw new ConcordError('UnsafePath', 'Cannot verify opened file through /proc/self/fd'); }
      if (opened.endsWith(' (deleted)')) {
        if (verifying) throw new ObservationChanged(path);
        throw new ConcordError('SourceChanged', `${path} was replaced while opening; retry the query`);
      }
      if (opened !== target) throw new ConcordError('UnsafePath', `Opened file resolved outside its expected path: ${path}`);
    }
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile()) throw new ConcordError(verifying ? 'UnsafePath' : 'InvalidFile', `${path} must be a regular file`);
    if (opened.size !== stat.size || opened.dev !== stat.dev || opened.ino !== stat.ino) {
      if (verifying) throw new ObservationChanged(path);
      throw new ConcordError('SourceChanged', `${path} was replaced while opening; retry the query`);
    }
    if (opened.size > BigInt(MAX_BYTES)) {
      if (verifying) throw new ObservationChanged(path);
      throw new ConcordError('InvalidFile', `${path} exceeds ${MAX_BYTES} bytes`);
    }
    return readFileSync(fd);
  } catch (cause) {
    if (errno(cause, 'ELOOP')) throw new ConcordError('UnsafePath', `Symbolic links are not permitted: ${path}`);
    if (cause instanceof ConcordError) throw cause;
    if (verifying) throw new ObservationChanged(path);
    if (errno(cause, 'ENOENT')) throw new ConcordError('SourceChanged', `${path} disappeared while opening; retry the query`);
    throw cause;
  } finally { if (fd !== undefined) closeSync(fd); }
}
function readCheckedFile(target: string, path: string, stat: BigIntStats, verifying = false): string {
  return readCheckedBytes(target, path, stat, verifying).toString('utf8');
}

/** Standalone reads keep the full path guard and never reuse snapshot listings. */
export function readRepositoryFileSync(root: string, path: string): string | undefined {
  assertReadHost();
  canonicalPath(path);
  const repositoryRoot = resolve(root);
  const target = resolve(repositoryRoot, path);
  if (!target.startsWith(repositoryRoot.endsWith(sep) ? repositoryRoot : `${repositoryRoot}${sep}`)) throw new ConcordError('UnsafePath', path);
  assertNoSymlink(target);
  let stat: BigIntStats;
  try { stat = lstatSync(target, { bigint: true }); }
  catch (cause) { if (errno(cause, 'ENOENT')) return undefined; throw cause; }
  return readCheckedFile(target, path, stat);
}
// @concord-end

// @concord-begin
// @concord-implements docs/feature/local-sdlc/architecture.md#写入管线
export function assertDarwinPublicationPaths(paths: readonly string[], platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'darwin') return;
  const seen = new Map<string, string>();
  for (const path of paths) {
    const parts = path.split('/');
    for (let index = 1; index <= parts.length; index += 1) {
      const prefix = parts.slice(0, index).join('/');
      const key = darwinPathCollisionKey(prefix);
      const previous = seen.get(key);
      if (previous !== undefined && previous !== prefix) throw new ConcordError('InvalidChange', `Darwin publication paths collide by case or Unicode normalization: ${previous} and ${prefix}`);
      seen.set(key, prefix);
    }
  }
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
const JournalChangeSchema = Schema.Struct({ path: Text, before: Schema.NullOr(Schema.String), after: Schema.NullOr(Schema.String), beforeDigest: Schema.NullOr(Text), afterDigest: Schema.NullOr(Text), mode: Schema.Int });
const JournalScopeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('documents'), configPath: Schema.Literal('concord.config.ts'), configSource: Schema.String, configDigest: Text }),
  Schema.Struct({ kind: Schema.Literal('source'), configPath: Schema.Literal('concord.config.ts'), configSource: Schema.String, configDigest: Text }),
  Schema.Struct({ kind: Schema.Literal('issue-close'), configPath: Schema.Literal('concord.config.ts'), configSource: Schema.String, configDigest: Text, issue: Text, inputsDigest: Text, testFiles: Schema.Array(Text) }),
  Schema.Struct({ kind: Schema.Literal('step-rename'), configPath: Schema.Literal('concord.config.ts'), configSource: Schema.String, configDigest: Text, useCase: Text, oldId: Text, newId: Text, inputsDigest: Text, memberships: Schema.Array(Schema.Struct({ path: Text, scope: Schema.optional(Schema.Literal('source')), observation: Schema.String })) }),
]);
const JournalSchema = Schema.Struct({
  format: Schema.Literal('concord.journal'), root: Text, privateDir: Text, operation: Text,
  phase: Schema.Literals(['prepared', 'committed']), directories: Schema.Array(Text), changes: Schema.Array(JournalChangeSchema), scope: JournalScopeSchema,
});
type Journal = typeof JournalSchema.Type;

function currentJournal(path: string): Journal {
  return jsonFile(path, JournalSchema);
}
// @concord-end

/** Refusal only: callers must still acquire a lease and repeat this check before ordinary work. */
// @concord-code
// @concord-implements docs/feature/project-onboarding/use-case/maintain-project-config.md
export function assertCurrentRuntimeFormat(root: string, privateDir = genericPrivateDirectorySync(root)): void {
  const journal = join(privateDir, 'journal.json');
  if (present(journal)) currentJournal(journal);
}

// @concord-begin
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md#完整路径
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/u;
export const forbiddenSourcePart = (path: string): boolean => path.split('/').some(part => part === '.git' || part === 'node_modules');

// @concord-end
// @concord-begin
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md#随包模板
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md#agent-指引的边界
export function resolveProjectConfig(root: string, config: ProjectConfig): ResolvedProjectConfig {
  const exists = (path: string): boolean => {
    try { return lstatSync(join(root, path)).isDirectory(); } catch (cause) { if (errno(cause, 'ENOENT')) return false; throw cause; }
  };
  return { ...config, testRoots: config.testRoots ?? ['test', 'tests'].filter(exists), sourceRoots: config.sourceRoots ?? ['src'].filter(exists) };
}
const fixedOwner = (path: string): boolean => path === 'docs/writing.md' || path === 'AGENTS.md' || path === 'concord.config.ts' || path === 'DESIGN.md' || path.startsWith('docs/') && path.endsWith('.md');

export const AGENT_RULE_BEGIN = '<!-- BEGIN CONCORD AGENT INSTRUCTIONS -->';
export const AGENT_RULE_END = '<!-- END CONCORD AGENT INSTRUCTIONS -->';
export const AGENT_RULE_CONTENT = `## Concord

This repository uses Concord-driven development. Product contracts, executable test relationships, and engineering memory stay in repository-owned sources.

Before planning, implementing, or reviewing governed work:

- Run \`concord --skill\` to read the task router from the installed Concord version.
- Run \`concord --skill <topic>\` for the relevant workflow, where topics include \`init\`, \`document\`, \`code\`, \`test\`, \`memory\`, \`trace\`, \`recovery\`, \`view\`, \`feedback\`.
- Use \`concord --skill all\` only when the complete offline guide is needed.
- Before changing behavior, read or update the owning Feature, leaf Use Case, documented CLI page, and any required Design. Then run \`concord trace gaps --json\` to inspect missing explicit code/test relationships before implementation.
- Write contracts as declarations of intended behavior, constraints, and acceptance. Keep development logs, investigation history, and implementation progress in Memory; product workflows remain valid contract content.
- Directly edit files under \`docs/\` and \`memory/\`, including relations. Use \`concord memory search\` and \`concord issue search\` for search. Commands run required steps such as fix verification; run \`concord check\` before delivery. Do not maintain a manual INDEX.
- For remote Issue writes, run remote preview, obtain explicit user agreement to its authorization string (or its action, target, and payload), then remote apply with \`--authorize\`; never infer authorization from preview success, tool availability, or permissive access.
- Local issues work without GitHub, Linear, credentials, or connections. Use \`concord new issue\` for local observations; local operations never authorize remote mutations.
- Directly edit directory-scoped \`concepts.md\` and \`writing.md\`; \`concord check\` validates them. Keep each concept's term, definition and explanation together; only deprecated names become terminology bans.

Follow the returned instructions and the repository's current \`docs/taste.md\`. A gap result means an explicit Concord relationship is absent; it is not code coverage, and undocumented CLI commands require the product's own inventory. Do not infer completion or test coverage from document structure or command receipts alone.`;
// @concord-end

export interface RepositoryOptions { readonly runtime?: RuntimeEnvironmentSnapshot; readonly environment?: Readonly<Record<string, string | undefined>>; readonly initialize?: boolean; readonly recover?: boolean; readonly reclaimPublication?: boolean; readonly dryRun?: boolean; readonly access?: 'read' | 'write'; readonly persistentCache?: 'use' | 'off'; readonly optimistic?: boolean }
export interface ReadRepositoryOptions extends RepositoryOptions { readonly access: 'read' }

export class LocalRepository implements Repository {
  private readonly runtime: RuntimeEnvironmentSnapshot;
  private readonly configContentCache: ReturnType<typeof makeConfigContentCache>;
  private readonly executionEnvironment: Readonly<Record<string, string | undefined>>;
  readonly runtimeVersion = process.version;
  exists(path: string): boolean { return this.inspectComponents(path).stat !== undefined; }
  runtimeInputs(command: string, envNames: readonly string[]) { return adapterRuntimeInputs(this.root, command, envNames, this.executionEnvironment); }
  environment(names?: readonly string[]): Readonly<Record<string, string | undefined>> { return names === undefined ? this.executionEnvironment : Object.freeze(Object.fromEntries(names.map(name => [name, this.executionEnvironment[name]]))); }
  inspect(path: string): ReturnType<NonNullable<Repository['inspect']>> {
    const read = () => {
      const stat = this.inspectComponents(path).stat;
      return stat === undefined ? undefined : { file: stat.isFile(), directory: stat.isDirectory(), symbolicLink: stat.isSymbolicLink(), size: Number(stat.size), mode: Number(stat.mode), identity: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}` };
    };
    return this.snapshotDepth === 0 ? this.underLease(read) : read();
  }
  readBytes(path: string): Uint8Array | undefined {
    const read = () => {
      const source = this.readCurrentBytes(path);
      if (this.observing && !this.observedBytes.has(path)) this.observedBytes.set(path, source === undefined ? undefined : Buffer.from(source));
      return source;
    };
    return this.snapshotDepth === 0 ? this.underLease(read) : read();
  }
  rootFiles(): readonly string[] {
    const read = () => {
      const paths = this.currentRootFiles();
      this.observedRootFiles ??= JSON.stringify(paths);
      return paths;
    };
    return this.snapshotDepth === 0 ? this.underLease(read) : read();
  }
  private currentRootFiles(): string[] {
    this.checkRoot();
    return readdirSync(this.root).filter(path => lstatSync(join(this.root, path)).isFile()).sort();
  }
  readonly access: 'read' | 'write';
  readonly persistentCache: 'use' | 'off';
  readonly root: string;
  readonly privateDir: string;
  config: ResolvedProjectConfig;
  configSnapshot: ConfigSnapshot;
  private traceLease: TraceLease | undefined;
  private readonly coordinationDirectory: string;
  private readonly noWrite: boolean;
  private snapshotDepth = 0;
  private previewWithoutState = false;
  private readonly recovering: boolean;
  private observing = true;
  private readonly optimistic: boolean;
  private readonly observedFiles = new Map<string, string | undefined>();
  private readonly observedBytes = new Map<string, Buffer | undefined>();
  private observedRootFiles: string | undefined;
  private readonly observedDirectories = new Map<string, { path: string; scope: 'source' | undefined; observation: string; files: readonly string[] }>();
  private readonly rootAnchor: readonly RootAnchor[];
  private rootFd: number | undefined;
  private readonly listings = new Map<string, Buffer[]>();
  private readonly checkedSegments = new Set<string>();
  private verifyListings: Map<string, Buffer[]> | undefined;
  private readonly validation?: PublicationValidation['Service'];
  constructor(input: string | undefined, options: ReadRepositoryOptions);
  constructor(input: string | undefined, options: RepositoryOptions, validation: PublicationValidation['Service']);
  constructor(input?: string, options: RepositoryOptions = {}, validation?: PublicationValidation['Service']) {
    this.validation = validation;
    const environment = Object.freeze({ ...(options.environment ?? options.runtime?.env ?? {}) });
    this.root = discoverRoot(input, options.initialize, options.runtime === undefined ? undefined : { cwd: options.runtime.cwd, env: environment });
    this.runtime = inheritContentCacheOwner(makeRuntimeEnvironment(options.runtime?.cwd ?? this.root, environment), options.runtime, this.root);
    bindRepositoryRuntime(this, this.runtime);
    this.executionEnvironment = this.runtime.env;
    this.configContentCache = makeConfigContentCache(this.runtime);
    assertNoSymlink(this.root);
    const anchors: RootAnchor[] = [];
    let anchorPath: string = sep;
    for (const segment of ['', ...this.root.slice(sep.length).split(sep)]) {
      if (segment !== '') anchorPath = join(anchorPath, segment);
      const stat = lstatSync(anchorPath, { bigint: true });
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new ConcordError('UnsafePath', `Root must consist of real directories: ${anchorPath}`);
      anchors.push({ path: anchorPath, dev: stat.dev, ino: stat.ino });
    }
    this.rootAnchor = anchors;
    this.recovering = options.recover ?? false;
    this.noWrite = options.dryRun ?? false;
    this.persistentCache = this.noWrite ? 'off' : options.persistentCache ?? 'use';
    this.access = options.access ?? 'write';
    this.optimistic = !options.recover && (this.access === 'read' || this.noWrite || options.optimistic === true);
    if (options.recover && this.access === 'read') throw new ConcordError('InvalidOption', 'Recovery requires write access');
    if (options.recover && this.noWrite) throw new ConcordError('InvalidOption', 'recover does not accept --dry-run');
    assertReadHost();
    if (git(this.root, ['rev-parse', '--show-toplevel'], this.executionEnvironment) !== this.root) throw new ConcordError('ProjectRootInvalid', 'The project must be the Git worktree top-level directory');
    const privateDir = genericPrivateDirectorySync(this.root, this.executionEnvironment);
    assertCurrentRuntimeFormat(this.root, privateDir);
    this.privateDir = privateDir;
    assertNoSymlink(this.privateDir);
    this.coordinationDirectory = tracePrivateDirectorySync(this.root, this.executionEnvironment);
    try {
      this.openRoot();
      this.snapshotDepth = 1;
      const coordinationDir = this.coordinationDirectory;
      assertNoSymlink(coordinationDir);
      // Only a new owner-free, lock-free repository may preview without creating private state.
      const emptyPreview = options.initialize === true && this.noWrite
        && !['concord.config.ts', 'docs', 'memory', 'DESIGN.md'].some(path => present(this.absolute(path)))
        && ![join(this.privateDir, 'lock.json'), join(this.privateDir, 'journal.json'), join(coordinationDir, PUBLICATION_LEASE), join(coordinationDir, 'publication-journal.json'), join(coordinationDir, 'multi-file-publication-journal.json')].some(present);
      this.previewWithoutState = emptyPreview;
      if (options.recover && options.reclaimPublication !== false) recoverPublicationLeaseSync(this.root, this.executionEnvironment);
      try {
        if (!this.optimistic) this.traceLease = acquireTraceLeaseSync(this.root, 'exclusive', options.recover ? 'recover' : 'repository', !emptyPreview, !options.recover && options.reclaimPublication !== false, this.executionEnvironment);
      }
      catch (cause) { throw storageCoordinationFailure(cause); }
      assertNoSymlink(this.privateDir);
      assertCurrentRuntimeFormat(this.root, this.privateDir);
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
      if (options.initialize && marker !== undefined) throw new ConcordError('ProjectExists', `${markerPath} already exists`);
      this.configSnapshot = marker === undefined ? { path: 'concord.config.ts', source: '', digest: digest(''), config: {} } : snapshot(markerPath, marker, this.persistentCache === 'off' ? undefined : this.privateDir, false, this.runtime, this.configContentCache);
      this.config = resolveProjectConfig(this.root, this.configSnapshot.config);
      this.validateConfiguredRoots(this.config);
      for (const path of [...this.config.testRoots, ...(this.config.sourceRoots ?? []), ...(this.config.runner?.sourceFiles ?? [])]) this.absolute(path);
      for (const adapter of this.config.testAdapters ?? []) {
        for (const path of [...adapter.include, ...adapter.inputRoots, ...adapter.implementationFiles, ...adapter.lockFiles]) this.absolute(path);
      }
      if (recoveryJournal !== undefined) this.preflight(recoveryJournal, true);
      if (this.optimistic) this.verifySnapshot();

    } catch (cause) { this.close(); throw cause; }
    finally { this.close(); }
  }
  // @concord-code
  // @concord-implements docs/feature/local-sdlc/architecture.md#操作依赖
  absolute(path: string): string {
    canonicalPath(path);
    const target = resolve(this.root, path);
    if (!target.startsWith(`${this.root}${sep}`)) throw new ConcordError('UnsafePath', path);
    assertNoSymlink(target);
    return target;
  }
  private changedPath(path: string): never {
    if (this.verifyListings !== undefined) throw new ObservationChanged(path);
    throw new ConcordError('UnsafePath', `Path identity or spelling changed: ${path}`);
  }
  private checkRoot(): void {
    try {
      for (const anchor of this.rootAnchor) {
        const stat = lstatSync(anchor.path, { bigint: true });
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new ConcordError('UnsafePath', `Root must consist of real directories: ${anchor.path}`);
        if (stat.dev !== anchor.dev || stat.ino !== anchor.ino) this.changedPath('.');
      }
      if (this.rootFd !== undefined) {
        const stat = fstatSync(this.rootFd, { bigint: true });
        const anchor = this.rootAnchor[this.rootAnchor.length - 1]!;
        if (!stat.isDirectory() || stat.dev !== anchor.dev || stat.ino !== anchor.ino) this.changedPath('.');
      }
    } catch (cause) {
      if (cause instanceof ConcordError) throw cause;
      if (errno(cause, 'ELOOP')) throw new ConcordError('UnsafePath', 'Symbolic links are not permitted in the root anchor');
      this.changedPath('.');
    }
  }
  private openRoot(): void {
    this.checkRoot();
    this.rootFd = openSync(this.root, 'r');
    try { this.checkRoot(); } catch (cause) { closeSync(this.rootFd); this.rootFd = undefined; throw cause; }
    this.clearPathObservations();
  }
  private clearPathObservations(): void { this.listings.clear(); this.checkedSegments.clear(); }
  private directoryListing(path: string): Buffer[] {
    const listings = this.verifyListings ?? this.listings;
    let entries = listings.get(path);
    if (entries === undefined) { entries = readdirSync(path, { encoding: 'buffer' }); listings.set(path, entries); }
    return entries;
  }
  private checkSpelling(parent: string, segment: string, path: string): void {
    if (process.platform !== 'darwin') return;
    const entries = this.directoryListing(parent);
    const key = darwinPathCollisionKey(segment);
    const exact = hasExactDarwinEntry(entries, segment);
    const alias = entries.some(entry => !entry.equals(Buffer.from(segment)) && darwinPathCollisionKey(entry.toString('utf8')) === key);
    if (alias || !exact && present(join(parent, segment))) this.changedPath(path);
    // Missing inputs are tracked by file/directory observations, not as existing spellings.
    if (exact && this.verifyListings === undefined) this.checkedSegments.add(path);
  }
  /** Only readCurrent and scanDirectory may use this snapshot-local resolver. */
  private readablePath(path: string): { target: string; stat: BigIntStats | undefined } {
    if (this.snapshotDepth === 0) {
      const target = this.absolute(path);
      try { return { target, stat: lstatSync(target, { bigint: true }) }; }
      catch (cause) { if (errno(cause, 'ENOENT')) return { target, stat: undefined }; throw cause; }
    }
    return this.inspectComponents(path);
  }
  private inspectComponents(path: string): { target: string; stat: BigIntStats | undefined } {
    canonicalPath(path);
    this.checkRoot();
    let parent = this.root;
    let name = '';
    let stat: BigIntStats | undefined;
    try {
      for (const segment of path.split('/')) {
        name = name === '' ? segment : `${name}/${segment}`;
        this.checkSpelling(parent, segment, name);
        parent = join(parent, segment);
        try { stat = lstatSync(parent, { bigint: true }); }
        catch (cause) { if (errno(cause, 'ENOENT')) return { target: join(this.root, path), stat: undefined }; throw cause; }
        if (stat.isSymbolicLink()) throw new ConcordError('UnsafePath', `Symbolic links are not permitted: ${parent}`);
      }
    } catch (cause) {
      if (errno(cause, 'ELOOP')) throw new ConcordError('UnsafePath', `Symbolic links are not permitted: ${path}`);
      if (this.verifyListings !== undefined && !(cause instanceof ConcordError)) throw new ObservationChanged(name);
      throw cause;
    }
    return { target: parent, stat };
  }
  // @concord-code
  // @concord-implements docs/feature/local-sdlc/architecture.md#操作依赖
  read(path: string): string | undefined {
    return this.snapshotDepth === 0 ? this.underLease(() => this.readObserved(path)) : this.readObserved(path);
  }
  private readObserved(path: string): string | undefined {
    const source = this.readCurrent(path);
    if (this.observing && !this.observedFiles.has(path)) this.observedFiles.set(path, source);
    return source;
  }
  private readCurrent(path: string): string | undefined {
    const { target, stat } = this.readablePath(path);
    return stat === undefined ? undefined : readCheckedFile(target, path, stat, this.verifyListings !== undefined);
  }
  private readCurrentBytes(path: string): Buffer | undefined {
    const { target, stat } = this.readablePath(path);
    return stat === undefined ? undefined : readCheckedBytes(target, path, stat, this.verifyListings !== undefined);
  }
  // @concord-code
  // @concord-implements docs/feature/local-sdlc/architecture.md#操作依赖
  files(prefix: string, scope?: 'source'): string[] {
    return this.snapshotDepth === 0 ? this.underLease(() => this.filesObserved(prefix, scope)) : this.filesObserved(prefix, scope);
  }
  private filesObserved(prefix: string, scope?: 'source'): string[] {
    const key = canonical([prefix, scope ?? 'all']);
    const prior = this.observedDirectories.get(key);
    const scanned = this.scanDirectory(prefix, scope);
    if (this.observing && !prior) this.observedDirectories.set(key, { path: prefix, scope, observation: scanned.observation, files: [...scanned.files] });
    return scanned.files;
  }
  private sourcePath(path: string, roots: readonly string[]): void {
    canonicalPath(path);
    if (!SOURCE_EXTENSION.test(path) || forbiddenSourcePart(path)) throw new ConcordError('InvalidSourcePath', `Source must be a JavaScript or TypeScript file in a configured source root: ${path}`);
    if (roots.length === 0 || !roots.some(root => path === root || path.startsWith(`${root}/`))) throw new ConcordError('InvalidSourcePath', `Source is outside configured sourceRoots or testRoots: ${path}`);
    this.absolute(path);
  }
  private sourceScopeRoots(config: ProjectConfig): readonly string[] {
    const roots = [...(config.testRoots ?? []), ...(config.sourceRoots ?? [])];
    const unique = [...new Set(roots)].sort();
    if (unique.length === 0) throw new ConcordError('InvalidSourcePath', 'source.set requires at least one configured sourceRoot or testRoot');
    for (const root of unique) this.validateConfiguredRoot(root);
    return unique;
  }
  // @concord-code
  // @concord-implements docs/feature/project-onboarding/use-case/maintain-project-config.md#完整路径
  private validateConfiguredRoots(config: ProjectConfig): void {
    for (const root of [...(config.testRoots ?? []), ...(config.sourceRoots ?? [])]) this.validateConfiguredRoot(root);
  }
  private validateProjectConfig(config: ProjectConfig): void {
    this.validateConfiguredRoots(config);
    for (const path of config.runner?.sourceFiles ?? []) this.absolute(path);
  }
  private allowedOwner(path: string, _config: ProjectConfig = this.config): boolean { return fixedOwner(path) || isWorkflowSkillPath(path) || path.startsWith('memory/') && path.endsWith('.md') || path.startsWith('docs/') && path.endsWith('/writing.md'); }
  private currentSnapshot(): ConfigSnapshot {
    const source = this.read('concord.config.ts');
    return snapshot('concord.config.ts', source ?? '', this.persistentCache === 'off' ? undefined : this.privateDir, source === undefined, this.runtime, this.configContentCache);
  }
  private validateConfiguredRoot(root: string): void {
      canonicalPath(root);
      if (forbiddenSourcePart(root)) throw new ConcordError('InvalidSourcePath', `Unsafe sourceRoot: ${root}`);
      this.absolute(root);
  }
  /** An explicit coherent source-read section; never include network or runner waits. */
  // @concord-code
  // @concord-implements docs/feature/portable-coordination/architecture.md#entity-ownership
  snapshot<A>(read: () => A): A {
    if (this.snapshotDepth === 0) { this.observedFiles.clear(); this.observedBytes.clear(); this.observedRootFiles = undefined; this.observedDirectories.clear(); }
    return this.underLease(read);
  }
  /** Historical navigation only. Current queries and publications still verify strictly. */
  // @concord-code
  // @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
  observeProjection<A>(read: () => A): { value: A; drift: { files: string[]; directories: string[]; publicationChanged: boolean } } {
    if (this.snapshotDepth !== 0 || !this.optimistic) throw new ConcordError('InvalidProjectionRead', 'Projection observation requires an independent optimistic snapshot');
    this.observedFiles.clear(); this.observedBytes.clear(); this.observedRootFiles = undefined; this.observedDirectories.clear();
    this.beginSnapshot();
    try {
      const value = read();
      // The candidate owns decoded values now; drift collection needs no cache handle.
      closeRepositoryCache(this);
      const { files, directories } = this.verifyObservations(true);
      this.assertNoPendingPublication();
      const publicationChanged = false;
      return { value, drift: { files, directories, publicationChanged } };
    } finally { this.endSnapshot(); }
  }
  private underLease<A>(read: () => A): A {
    this.beginSnapshot();
    try { const value = read(); if (this.snapshotDepth === 1) this.verifySnapshot(); return value; } finally { this.endSnapshot(); }
  }
  /** Optimistic reads never hold up a publisher; changed inputs reject the result. */
  // @concord-code
  // @concord-implements docs/feature/portable-coordination/architecture.md#entity-ownership
  verifySnapshot(): void {
    if (!this.optimistic || this.snapshotDepth === 0) return;
    try { this.validateObservations(); this.assertNoPendingPublication(); }
    catch (cause) {
      if (cause instanceof ConcordError && cause.code === 'FileChangedSinceRead') throw new ConcordError('SourceChanged', 'Sources changed during the snapshot; retry the query', cause.details);
      throw cause;
    }
  }
  // @concord-code
  // @concord-implements docs/feature/portable-coordination/architecture.md#entity-ownership
  beginSnapshot(reclaimDead = true): void {
    if (this.snapshotDepth > 0) { this.snapshotDepth++; return; }
    if (this.access === 'read') { this.observedFiles.clear(); this.observedBytes.clear(); this.observedRootFiles = undefined; this.observedDirectories.clear(); }
    try {
      const acquire = this.recovering || !reclaimDead ? acquireFileLease : acquireRecoverablePublicationLease;
      if (!this.optimistic) this.traceLease = acquire(this.root, this.coordinationDirectory, PUBLICATION_LEASE, 'exclusive', 'snapshot', !this.previewWithoutState);
      this.openRoot();
      this.snapshotDepth = 1;
      this.assertReady();
    } catch (cause) { this.close(); throw storageCoordinationFailure(cause); }
  }
  // @concord-code
  // @concord-implements docs/feature/portable-coordination/architecture.md#entity-ownership
  endSnapshot(): void {
    if (this.snapshotDepth === 0) return;
    this.snapshotDepth--;
    if (this.snapshotDepth === 0) {
      try { closeRepositoryCache(this); }
      finally {
        try { if (this.rootFd !== undefined) { const fd = this.rootFd; this.rootFd = undefined; closeSync(fd); } }
        finally {
          this.clearPathObservations();
          if (this.traceLease !== undefined) {
            const lease = this.traceLease;
            this.traceLease = undefined;
            releaseTraceLeaseSync(lease, 'snapshot-close');
          }
        }
      }
    }
  }
  // @concord-code
  // @concord-implements docs/feature/portable-coordination/architecture.md#entity-ownership
  close(): void {
    this.configContentCache.close();
    this.snapshotDepth = this.snapshotDepth > 0 || this.traceLease !== undefined || this.rootFd !== undefined ? 1 : 0;
    this.endSnapshot();
    closeRepositoryCache(this);
  }
  private assertNoPendingPublication(): void {
    const directory = this.coordinationDirectory;
    const pending = ['publication-journal.json', 'multi-file-publication-journal.json'].filter(name => present(join(directory, name)));
    if (pending.length > 0) throw new ConcordError('RecoveryRequired', 'An interrupted Trace publication exists; run concord recover');
    if (!this.recovering && present(join(this.privateDir, 'journal.json'))) throw new ConcordError('RecoveryRequired', 'An interrupted publication exists; run concord recover');
  }
  private assertReady(): void {
    assertCurrentRuntimeFormat(this.root, this.privateDir);
    this.assertNoPendingPublication();
    if (!this.recovering && this.configSnapshot !== undefined && this.readCurrent('concord.config.ts') !== (this.configSnapshot.source === '' ? undefined : this.configSnapshot.source)) throw new ConcordError('FileChangedSinceRead', 'Project configuration changed; open a fresh repository snapshot', 'source-observation');
  }
  // @concord-code
  // @concord-implements docs/feature/local-sdlc/use-case/discover-annotated-tests.md#忽略路径
  private scanDirectory(prefix: string, scope?: 'source'): { observation: string; files: string[] } {
    const { stat } = this.readablePath(prefix);
    if (stat === undefined) return { observation: 'absent', files: [] };
    const entries: string[] = [];
    const files: string[] = [];
    const visit = (name: string, stat: BigIntStats): void => {
      entries.push(`${name}:${stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other'}:${stat.mode & 0o777n}:${stat.isFile() ? stat.size : ''}`);
      if (stat.isFile()) files.push(name);
      else if (!stat.isDirectory()) throw new ConcordError(this.verifyListings === undefined ? 'InvalidFile' : 'UnsafePath', `Unsupported file type: ${name}`);
      if (stat.isDirectory()) {
        const directory = join(this.root, name);
        const members = readdirSync(directory, { encoding: 'buffer' });
        // Membership is current on every scan; only spelling checks reuse this list.
        (this.verifyListings ?? this.listings).set(directory, members);
        for (const child of members.map(entry => entry.toString('utf8')).sort()) {
          if (child === '.git' || child === 'node_modules') continue;
          const childName = `${name}/${child}`;
          if (scope === 'source' && excludedSourcePath(childName, prefix, this.config.sourceIgnore ?? [])) continue;
          const { stat: childStat } = this.readablePath(childName);
          if (childStat === undefined) {
            if (this.verifyListings !== undefined) throw new ObservationChanged(childName);
            throw new ConcordError('SourceChanged', `${childName} disappeared during scanning; retry the query`);
          }
          visit(childName, childStat);
        }
      }
    };
    visit(prefix, stat);
    return { observation: canonical(entries), files };
  }
  private validateObservations(): void {
    this.verifyObservations(false);
  }
  // @concord-code
  // @concord-implements docs/feature/portable-coordination/architecture.md#entity-ownership
  private verifyObservations(collect: boolean): { files: string[]; directories: string[] } {
    const files = new Set<string>();
    const directories = new Set<string>();
    const verify = (path: string, target: Set<string>, read: () => void): void => {
      try { read(); }
      catch (cause) {
        if (errno(cause, 'ELOOP')) throw new ConcordError('UnsafePath', `Symbolic links are not permitted: ${path}`);
        if (cause instanceof ConcordError && cause.code === 'UnsafePath') throw cause;
        const changed = cause instanceof ObservationChanged ? cause.path : path;
        if (cause instanceof ConcordError && cause.code !== 'FileChangedSinceRead' && cause.code !== 'SourceChanged') throw cause;
        if (!collect) throw new ObservationChanged(changed);
        target.add(changed);
      }
    };
    this.verifyListings = new Map();
    try {
      verify('.', files, () => this.checkRoot());
      // An invalid anchor makes all path-based comparisons unreliable.
      if (files.has('.')) return { files: ['.'], directories: [] };
      for (const path of this.checkedSegments) verify(path, files, () => {
        const { stat } = this.inspectComponents(path);
        const entries = this.directoryListing(join(this.root, dirname(path)));
        if (stat === undefined || !hasExactDarwinEntry(entries, path.split('/').at(-1)!)) throw new ObservationChanged(path);
      });
      verify('concord.config.ts', files, () => this.assertReady());
      for (const [path, source] of this.observedFiles) verify(path, files, () => { if (this.readCurrent(path) !== source) throw new ObservationChanged(path); });
      for (const [path, source] of this.observedBytes) verify(path, files, () => {
        const current = this.readCurrentBytes(path);
        if (source === undefined ? current !== undefined : current === undefined || !source.equals(current)) throw new ObservationChanged(path);
      });
      if (this.observedRootFiles !== undefined) verify('.', directories, () => { if (JSON.stringify(this.currentRootFiles()) !== this.observedRootFiles) throw new ObservationChanged('.'); });
      for (const { path, scope, observation } of this.observedDirectories.values()) verify(path, directories, () => { if (this.scanDirectory(path, scope).observation !== observation) throw new ObservationChanged(path); });
      return { files: [...files].sort(), directories: [...directories].sort() };
    } finally { this.verifyListings = undefined; }
  }
  // @concord-code
  // @concord-implements docs/feature/local-sdlc/architecture.md#写入管线
  publish(operation: string, changes: readonly Change[], dryRun = false): MutationReceipt {
    if (this.access === 'read' && !dryRun && !this.noWrite) throw new ConcordError('ReadOnlyRepository', 'Publication requires write access');
    const managedWritingOwner = (path: string) => path.startsWith('docs/') && !path.split('/').some(part => part === '_template' || part === '.git' || part === 'node_modules') && (path.endsWith(`/${policyName}`) || path.endsWith(`/${catalogName}`));
    if (operation === 'init') {
      const policies = changes.filter(change => managedWritingOwner(change.path) && change.path.endsWith(`/${policyName}`));
      if (policies.length > 0 && (policies.length !== 1 || policies[0]!.path !== 'docs/writing.md' || policies[0]!.before !== null || policies[0]!.after !== defaultWritingSource)) throw new ConcordError('InvalidChange', 'Init may only create the exact global writing preset');
      const catalogs = changes.filter(change => managedWritingOwner(change.path) && change.path.endsWith(`/${catalogName}`));
      if (catalogs.length > 0 && (catalogs.length !== 1 || catalogs[0]!.path !== 'docs/concepts.md' || catalogs[0]!.before !== null || catalogs[0]!.after !== EMPTY_CONCEPT_CATALOG)) throw new ConcordError('InvalidChange', 'Init may only create the exact empty global catalog');
    }
    if (changes.length === 0) return { operation, dryRun, changedPaths: [] };
    if (new Set(changes.map(c => c.path)).size !== changes.length) throw new ConcordError('InvalidChange', 'A path occurs more than once in the publication');
    const configChanges = changes.filter((change) => change.path === 'concord.config.ts');
    if (configChanges.length > 1) throw new ConcordError('InvalidChange', 'A publication may contain only one project configuration change');
    const plannedConfigChange = configChanges[0];
    if (plannedConfigChange?.after === null) throw new ConcordError('InvalidChange', 'The runtime configuration cannot be deleted or renamed');
    if (operation === 'set-config' && changes.length !== 1) throw new ConcordError('InvalidChange', 'config.set must publish exactly one configuration');
    const authorizationConfig = plannedConfigChange?.after === null || plannedConfigChange?.after === undefined ? this.config : snapshot(plannedConfigChange.path as ConfigSnapshot['path'], plannedConfigChange.after, dryRun || this.persistentCache === 'off' ? undefined : this.privateDir, false, this.runtime, this.configContentCache).config;
    if (plannedConfigChange?.after !== null && plannedConfigChange?.after !== undefined) this.validateProjectConfig(authorizationConfig);
    const entries = changes.map(c => {
      this.absolute(c.path);
      if (!this.allowedOwner(c.path, authorizationConfig) && !isObsoleteWorkflowSkillRemoval(operation, c) && !(operation === 'init' && c.path === 'docs/concepts.md')) throw new ConcordError('InvalidChange', `Not a Concord document owner: ${c.path}`);
      const current = this.read(c.path) ?? null;
      if (current !== c.before) throw new ConcordError('FileChangedSinceRead', `${c.path} changed; read its current digest and retry`);
      if (c.before === null && c.after === null) throw new ConcordError('InvalidChange', 'An absent preimage cannot guard an absent target');
      return { ...c, beforeDigest: c.before === null ? null : digest(c.before), afterDigest: c.after === null ? null : digest(c.after), mode: current === null ? 0o644 : lstatSync(this.absolute(c.path)).mode & 0o777 };
    });
    const directories = new Set<string>();
    for (const c of entries) { let dir = dirname(c.path); while (dir !== '.') { if (!present(this.absolute(dir))) directories.add(dir); dir = dirname(dir); } }
    const isInit = operation === 'init' && this.configSnapshot.source === '';
    const journal: Journal = { format: 'concord.journal', root: this.root, privateDir: this.privateDir, operation, phase: 'prepared', directories: [...directories].sort((a,b) => a.length - b.length), changes: entries, scope: isInit ? { kind: 'documents', configPath: 'concord.config.ts', configSource: '', configDigest: digest('') } : { kind: 'documents', configPath: this.configSnapshot.path, configSource: this.configSnapshot.source, configDigest: this.configSnapshot.digest } };
    const receipt = this.publishJournal(journal, dryRun);
    if (!receipt.dryRun && plannedConfigChange?.after !== null && plannedConfigChange?.after !== undefined) {
      this.configSnapshot = snapshot(plannedConfigChange.path as ConfigSnapshot['path'], plannedConfigChange.after, this.persistentCache === 'off' ? undefined : this.privateDir, false, this.runtime, this.configContentCache);
      this.config = resolveProjectConfig(this.root, this.configSnapshot.config);
    }
    return receipt;
  }
  /** Publishes one existing configured JS/TS file using the unified source-set journal. */
  // @concord-code
  // @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md#验收
  publishSource(path: string, before: string, after: string, dryRun = false): MutationReceipt {
    if (this.access === 'read' && !dryRun && !this.noWrite) throw new ConcordError('ReadOnlyRepository', 'Publication requires write access');
    const frozen = this.currentSnapshot();
    const configSource = frozen.source;
    const config = frozen.config;
    const roots = this.sourceScopeRoots(config);
    this.sourcePath(path, roots);
    const target = this.absolute(path);
    const stat = lstatSync(target);
    if (!stat.isFile()) throw new ConcordError('InvalidSourcePath', `Source must be an existing regular file: ${path}`);
    const current = this.read(path);
    if (current === undefined || current !== before) throw new ConcordError('FileChangedSinceRead', `${path} changed; read its current digest and retry`);
    if (after === before) return { operation: 'set-source', dryRun: dryRun || this.noWrite, changedPaths: [] };
    const change = { path, before, after, beforeDigest: digest(before), afterDigest: digest(after), mode: stat.mode & 0o777 };
    const journal: Journal = {
      format: 'concord.journal', root: this.root, privateDir: this.privateDir, 
      operation: 'set-source', phase: 'prepared', directories: [], changes: [change],
      scope: { kind: 'source', configPath: frozen.path, configSource, configDigest: frozen.digest },
    };
    return this.publishJournal(journal, dryRun);
  }
  // @concord-code
  // @concord-implements docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed
  publishIssueClose(issue: string, dryRun = false): MutationReceipt {
    if (this.access === 'read' && !dryRun && !this.noWrite) throw new ConcordError('ReadOnlyRepository', 'Publication requires write access');
    const frozen = this.currentSnapshot();
    const plan = this.validation!.planIssueClose(this, { issue });
    const changes = plan.changes.map(change => {
      this.absolute(change.path);
      if (change.before === null || (this.read(change.path) ?? null) !== change.before) throw new ConcordError('FileChangedSinceRead', `${change.path} changed before Issue closure`);
      const stat = lstatSync(this.absolute(change.path));
      if (!stat.isFile()) throw new ConcordError('InvalidChange', 'Issue closure requires existing regular files');
      return { ...change, beforeDigest: digest(change.before), afterDigest: change.after === null ? null : digest(change.after), mode: stat.mode & 0o777 };
    });
    return this.publishJournal({ format: 'concord.journal', root: this.root, privateDir: this.privateDir, operation: 'close-issue', phase: 'prepared', directories: [], changes,
      scope: { kind: 'issue-close', configPath: frozen.path, configSource: frozen.source, configDigest: frozen.digest, issue: plan.issue, inputsDigest: plan.inputsDigest, testFiles: plan.testFiles } }, dryRun);
  }
  // @concord-code
  // @concord-implements docs/feature/local-sdlc/use-case/link-tests-to-steps.md#主流程
  publishStepRename(request: StepRename, dryRun = false): MutationReceipt {
    if (this.access === 'read' && !dryRun && !this.noWrite) throw new ConcordError('ReadOnlyRepository', 'Publication requires write access');
    const frozen = this.currentSnapshot();
    const plan = this.validation!.planStepRename(this, request);
    const changes = plan.changes.map(change => {
      this.absolute(change.path);
      if (change.before === null || change.after === null || this.read(change.path) !== change.before) throw new ConcordError('FileChangedSinceRead', `${change.path} changed before step rename`);
      const stat = lstatSync(this.absolute(change.path));
      if (!stat.isFile()) throw new ConcordError('InvalidChange', 'Step rename can only replace existing files');
      return { ...change, beforeDigest: digest(change.before), afterDigest: digest(change.after), mode: stat.mode & 0o777 };
    });
    return this.publishJournal({ format: 'concord.journal', root: this.root, privateDir: this.privateDir, operation: 'rename-step', phase: 'prepared', directories: [], changes,
      scope: { kind: 'step-rename', configPath: frozen.path, configSource: frozen.source, configDigest: frozen.digest, useCase: plan.useCase, oldId: plan.oldId, newId: plan.newId, inputsDigest: plan.inputsDigest, memberships: [...this.observedDirectories.values()].map(({ path, scope, observation }) => ({ path, ...(scope === undefined ? {} : { scope }), observation })) } }, dryRun);
  }
  // @concord-code
  // @concord-implements docs/feature/portable-coordination/architecture.md#data-flow
  private publishJournal(journal: Journal, dryRun: boolean): MutationReceipt {
    return this.underLease(() => {
      // Planning is optimistic. Only validation and publication serialize writers.
      const commitLease = this.optimistic && !dryRun && !this.noWrite
        ? acquireTraceLeaseSync(this.root, 'exclusive', 'publication', true, true, this.executionEnvironment) : undefined;
      if (commitLease !== undefined) this.traceLease = commitLease;
      try {
      this.validateObservations();
      this.clearPathObservations();
      this.observing = false;
      try {
        const receipt = this.publishUnderLease(journal, dryRun);
        if (!receipt.dryRun) {
          this.observedFiles.clear(); this.observedDirectories.clear();
          const config = journal.changes.find(change => change.path === 'concord.config.ts');
          if (config?.after !== undefined && config.after !== null) {
            this.configSnapshot = snapshot('concord.config.ts', config.after, this.persistentCache === 'off' ? undefined : this.privateDir, false, this.runtime, this.configContentCache);
            this.config = resolveProjectConfig(this.root, this.configSnapshot.config);
          }
        }
        return receipt;
      } finally { this.observing = true; }
      } finally {
        if (commitLease !== undefined) {
          try { closeRepositoryCache(this); }
          finally {
            this.traceLease = undefined;
            releaseTraceLeaseSync(commitLease, 'publication');
          }
        }
      }
    });
  }
  // @concord-code
  // @concord-implements docs/feature/local-sdlc/architecture.md#写入管线
  private publishUnderLease(journal: Journal, dryRun: boolean): MutationReceipt {
    if (Buffer.byteLength(canonical(journal)) > MAX_TRANSACTION_BYTES) throw new ConcordError('InvalidChange', 'Publication exceeds the transaction size limit');
    const changedPaths = journal.changes.map(change => change.path);
    // Validate the complete set before persisting a prepared journal; dry-run follows this same guard.
    this.preflight(journal);
    if (dryRun || this.noWrite) return { operation: journal.operation, dryRun: true, changedPaths };
    if (this.access !== 'write') throw new ConcordError('ReadOnlyRepository', 'Publication requires write access');
    if (this.traceLease?.mode !== 'exclusive') throw new ConcordError('RepositoryBusy', 'Publication requires an owned exclusive lease');
    this.clearPathObservations();
    invalidateActiveRun(this.root, this.executionEnvironment);
    const journalPath = join(this.privateDir, 'journal.json');
    if (present(journalPath)) throw new ConcordError('RecoveryRequired', 'Run concord recover before another publication');
    atomic(journalPath, `${canonical(journal)}\n`);
    try {
      this.preflight(journal);
      for (const dir of journal.directories) { const target = this.absolute(dir); mkdirSync(target, { recursive: true }); syncDirectory(dirname(target)); this.clearPathObservations(); }
      for (const change of journal.changes) {
        if (journal.scope.kind === 'source' || journal.scope.kind === 'step-rename' || journal.scope.kind === 'issue-close') {
          const current = this.currentSnapshot();
          if (current.path !== journal.scope.configPath || current.digest !== journal.scope.configDigest) throw new ConcordError('FileChangedSinceRead', 'Project configuration changed before source replacement');
        }
        if ((this.read(change.path) ?? null) !== change.before) throw new ConcordError('FileChangedSinceRead', `${change.path} changed before replacement`);
        this.apply(change.path, change.after, change.mode);
      }
      if (journal.scope.kind === 'step-rename' || journal.scope.kind === 'issue-close') this.preflight(journal, true);
      atomic(journalPath, `${canonical({ ...journal, phase: 'committed' })}\n`);
    } catch (cause) {
      throw new ConcordError('RecoveryRequired', `Publication stopped: ${cause instanceof Error ? cause.message : String(cause)}; run concord recover`);
    }
    try { this.pruneMovedRoadmap(journal); rmSync(journalPath); syncDirectory(this.privateDir); }
    catch {
      if (journal.scope.kind === 'step-rename' || journal.scope.kind === 'issue-close') throw new ConcordError('RecoveryRequired', 'Step rename committed but cleanup was interrupted; run concord recover');
      return { operation: journal.operation, dryRun: false, changedPaths, recoveryRequired: true };
    }
    return { operation: journal.operation, dryRun: false, changedPaths };
  }
  // @concord-code
  // @concord-implements docs/feature/local-sdlc/use-case/recover-local-state.md#写入保护
  private preflight(journal: Journal, recovering = false): void {
    const fail = (message: string): never => { throw new ConcordError(recovering ? journal.scope.kind === 'issue-close' ? 'RecoveryRequired' : 'RecoveryConflict' : 'FileChangedSinceRead', message); };
    if (journal.root !== this.root || journal.privateDir !== this.privateDir) fail('Publication belongs to a different worktree');
    if (new Set(journal.changes.map(change => change.path)).size !== journal.changes.length || journal.changes.length === 0) fail('Journal must contain unique changes');
    if (new Set(journal.directories).size !== journal.directories.length) fail('Journal contains duplicate directories');
    if (journal.operation === 'close-issue' && journal.scope.kind !== 'issue-close') fail('Issue closure requires its dedicated publication scope');
    if (journal.operation === 'rename-step' && journal.scope.kind !== 'step-rename') fail('Step rename requires its dedicated publication scope');
    const policyChanges = journal.changes.filter(change => change.path.endsWith(`/${policyName}`));
    const catalogChanges = journal.changes.filter(change => change.path.endsWith(`/${catalogName}`) && !change.path.split('/').some(part => part === '_template' || part === '.git' || part === 'node_modules'));
    if (journal.operation === 'init' && policyChanges.length > 0) {
      if (journal.operation === 'init') {
        if (policyChanges.length !== 1 || policyChanges[0]?.path !== 'docs/writing.md' || policyChanges[0].before !== null || policyChanges[0].after !== defaultWritingSource) fail('Init may only create the exact global writing preset. Preserve the journal; recover an older init with the version that created it before upgrading.');
      }
    }
    this.validation!.validateCatalog(this, journal, fail);
    assertDarwinPublicationPaths([...journal.changes.map((change) => change.path), ...journal.directories]);
    if (journal.scope.kind === 'issue-close') {
      const scope = journal.scope;
      if (journal.operation !== 'close-issue' || journal.directories.length !== 0) fail('Issue closure has an unauthorized operation or directory write');
      const current = this.currentSnapshot();
      if (digest(scope.configSource) !== scope.configDigest || current.path !== scope.configPath || current.digest !== scope.configDigest) fail('Issue closure project configuration changed');
      const before = new Map(journal.changes.map(change => [change.path, change.before]));
      const reader: Repository = { root: this.root, privateDir: this.privateDir, config: resolveProjectConfig(this.root, current.config), configSnapshot: current,
        environment: names => this.environment(names), runtimeInputs: (command, names) => this.runtimeInputs(command, names),
        read: path => before.has(path) ? before.get(path) ?? undefined : this.read(path), files: (path, scope) => this.files(path, scope), absolute: path => this.absolute(path), publish: () => { throw new ConcordError('InvalidChange', 'Recovery recomputation cannot publish'); } };
      bindRepositoryRuntime(reader, this.runtime);
      try {
        const plan = this.validation!.planIssueClose(reader, scope);
        if (plan.inputsDigest !== scope.inputsDigest || canonical(plan.testFiles) !== canonical(scope.testFiles) || canonical(plan.changes) !== canonical(journal.changes.map(({ path, before, after }) => ({ path, before, after })))) fail('Issue closure inputs or allowed rewrite differ from the journal');
        for (const change of journal.changes) {
          if (change.before === null || change.before === change.after || (change.path === scope.issue ? change.after !== null : change.after === null)) fail('Invalid Issue closure file images');
          const target = this.absolute(change.path);
          if (!present(target)) { if (!recovering || change.path !== scope.issue || change.after !== null) fail(`${change.path} disappeared`); continue; }
          const stat = lstatSync(target);
          if (!stat.isFile() || (stat.mode & 0o777) !== change.mode) fail(`${change.path} type or mode changed`);
        }
      } catch (cause) { fail(`Issue closure authorization failed: ${cause instanceof Error ? cause.message : String(cause)}`); }
    } else if (journal.scope.kind === 'step-rename') {
      const scope = journal.scope;
      if (journal.operation !== 'rename-step' || journal.directories.length !== 0) fail('Step rename cannot create directories or use another operation');
      const current = this.currentSnapshot();
      const before = new Map(journal.changes.map(change => [change.path, change.before]));
      const requiredMemberships = new Set<string>();
      const reader: Repository = { root: this.root, privateDir: this.privateDir, config: resolveProjectConfig(this.root, current.config), configSnapshot: current,
        environment: names => this.environment(names), runtimeInputs: (command, names) => this.runtimeInputs(command, names),
        read: path => before.has(path) ? before.get(path) ?? undefined : this.read(path), files: (path, scope) => { requiredMemberships.add(canonical([path, scope ?? 'all'])); return this.files(path, scope); }, absolute: path => this.absolute(path), publish: () => { throw new ConcordError('InvalidChange', 'Recovery recomputation cannot publish'); } };
      bindRepositoryRuntime(reader, this.runtime);
      try {
        const plan = this.validation!.planStepRename(reader, scope);
        if (plan.inputsDigest !== scope.inputsDigest || canonical(plan.changes) !== canonical(journal.changes.map(({ path, before, after }) => ({ path, before, after })))) fail('Step rename inputs or complete allowed rewrite differ from the journal');
        const recordedMemberships = new Set(scope.memberships.map(item => canonical([item.path, item.scope ?? 'all'])));
        if (recordedMemberships.size !== scope.memberships.length || [...requiredMemberships].some(key => !recordedMemberships.has(key))) fail('Step rename requires every observed directory membership');
        for (const membership of scope.memberships) {
          const observation = this.scanDirectory(membership.path, membership.scope).observation;
          const entries = observation === 'absent' ? undefined : decode(Schema.Array(Schema.String), JSON.parse(observation), 'step rename directory membership');
          const normalized = entries?.map(entry => {
            const change = journal.changes.find(change => entry.startsWith(`${change.path}:file:`));
            return change?.before == null ? entry : `${entry.slice(0, entry.lastIndexOf(':') + 1)}${Buffer.byteLength(change.before)}`;
          });
          if ((normalized === undefined ? 'absent' : canonical(normalized)) !== membership.observation) fail(`Step rename directory membership changed: ${membership.path}`);
        }
        for (const change of journal.changes) {
          if (change.before === null || change.after === null || change.before === change.after) fail('Step rename requires distinct existing file images');
          const stat = lstatSync(this.absolute(change.path));
          if (!stat.isFile() || (stat.mode & 0o777) !== change.mode) fail(`${change.path} type or mode changed`);
        }
      } catch (cause) { fail(`Step rename authorization failed: ${cause instanceof Error ? cause.message : String(cause)}`); }
    } else if (journal.scope.kind === 'source') {
      if (journal.operation !== 'set-source' || journal.changes.length !== 1 || journal.directories.length !== 0) fail('Source publication must replace exactly one existing file without directories');
      if (digest(journal.scope.configSource) !== journal.scope.configDigest) fail('Frozen project configuration digest is invalid');
      const frozenPath = journal.scope.configPath;
      const current = this.currentSnapshot();
      if (current.path !== frozenPath || current.digest !== journal.scope.configDigest) fail('Project configuration changed since source publication');
      const config = snapshot(frozenPath, journal.scope.configSource, this.persistentCache === 'off' ? undefined : this.privateDir, true, this.runtime, this.configContentCache).config;
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
          if (journal.scope.configSource !== '' || journal.scope.configPath !== 'concord.config.ts' || plannedConfigChange !== undefined && (plannedConfigChange.before !== null || plannedConfigChange.after == null)) fail('Invalid init configuration scope');
          const plannedSource = plannedConfigChange?.after ?? '';
          const typed = this.read('concord.config.ts');
          if (!recovering && typed !== undefined) fail('Project configuration appeared since init planning');
          authorizationConfig = snapshot('concord.config.ts', plannedSource as string, this.persistentCache === 'off' ? undefined : this.privateDir, true, this.runtime, this.configContentCache).config;
          this.validateProjectConfig(authorizationConfig);
        } else {
          authorizationConfig = snapshot(journal.scope.configPath as ConfigSnapshot['path'], journal.scope.configSource, this.persistentCache === 'off' ? undefined : this.privateDir, true, this.runtime, this.configContentCache).config;
          this.validateProjectConfig(authorizationConfig);
          const current = this.currentSnapshot();
          const recoveringPlannedConfig = recovering && plannedConfigChange?.path === journal.scope.configPath && plannedConfigChange.after !== null && current.source === plannedConfigChange.after;
          if (current.path !== journal.scope.configPath || current.source !== journal.scope.configSource && !recoveringPlannedConfig) fail('Project configuration changed since publication planning');
        }
      }
      if (plannedConfigChange?.after !== null && plannedConfigChange?.after !== undefined) {
        const next = snapshot(plannedConfigChange.path as ConfigSnapshot['path'], plannedConfigChange.after, this.persistentCache === 'off' ? undefined : this.privateDir, false, this.runtime, this.configContentCache).config;
        this.validateProjectConfig(next);
      }
      if (plannedConfigChange?.after === null) fail('A journal cannot delete the runtime configuration');
      if (authorizationConfig === undefined) fail('Missing current TS authorization');
      for (const change of journal.changes) {
          const scoped = journal.operation === 'init' && change.path === 'docs/concepts.md';
        if (!this.allowedOwner(change.path, authorizationConfig) && !isObsoleteWorkflowSkillRemoval(journal.operation, change) && !scoped) fail(`Not a Concord document owner: ${change.path}`);
      }
      for (const dir of journal.directories) {
        this.absolute(dir);
        if (!journal.changes.some(change => change.path.startsWith(`${dir}/`))) fail('Journal contains an unrelated directory');
      }
    }
    for (const change of journal.changes) {
      this.absolute(change.path);
      if (change.before === null && change.after === null) fail('An absent preimage cannot guard an absent target');
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
    this.clearPathObservations();
    const target = this.absolute(path);
    if (contents === null) { if (present(target)) { rmSync(target); syncDirectory(dirname(target)); } }
    else atomic(target, contents, mode);
    this.clearPathObservations();
  }
  /** File images are committed first, so prepared recovery can restore every source. */
  private pruneMovedRoadmap(journal: Journal): void {
    if (journal.operation !== 'roadmap-start') return;
    const directories = new Set<string>();
    for (const change of journal.changes) {
      if (change.after !== null || !/^docs\/roadmap\/[^/]+\//u.test(change.path)) continue;
      for (let directory = dirname(change.path); directory !== 'docs/roadmap'; directory = dirname(directory)) directories.add(directory);
    }
    for (const directory of [...directories].sort((left, right) => right.length - left.length)) {
      const target = this.absolute(directory);
      if (!present(target)) continue;
      rmdirSync(target); syncDirectory(dirname(target)); this.clearPathObservations();
    }
  }
  // @concord-code
  // @concord-implements docs/feature/local-sdlc/use-case/recover-local-state.md#完整路径
  recover(): { operation: string; status: string; changedPaths: readonly string[] } {
    return this.snapshot(() => this.recoverUnderLease());
  }
  // @concord-code
  // @concord-implements docs/feature/local-sdlc/use-case/recover-local-state.md#写入保护
  private recoverUnderLease(): { operation: string; status: string; changedPaths: readonly string[] } {
    this.clearPathObservations();
    const path = join(this.privateDir, 'journal.json');
    if (!present(path)) return { operation: 'recover', status: 'clean', changedPaths: [] };
    const journal = currentJournal(path);
    this.preflight(journal, true);
    if (journal.phase === 'prepared') {
      invalidateActiveRun(this.root, this.executionEnvironment);
      for (const change of [...journal.changes].reverse()) {
        if (journal.scope.kind === 'source' || journal.scope.kind === 'step-rename' || journal.scope.kind === 'issue-close') {
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
    if (journal.phase === 'committed') this.pruneMovedRoadmap(journal);
    rmSync(path); syncDirectory(this.privateDir);
    return { operation: 'recover', status: journal.phase === 'prepared' ? 'rolled-back' : 'committed', changedPaths: journal.changes.map(c => c.path) };
  }
}

export function readRepositoryBytesSync(root: string, path: string, runtime?: RuntimeEnvironmentSnapshot): Uint8Array | undefined {
  const repo = new LocalRepository(root, { access: 'read', optimistic: true, runtime });
  try { return repo.snapshot(() => repo.readBytes(path)); } finally { repo.close(); }
}
