import type { RuntimeEnvironmentSnapshot } from '../../base/environment/index.ts';
import { repositoryRuntime } from '../../base/workspace/index.ts';
import { snapshotMetadata } from '../../base/sources/index.ts';
import { Schema } from "effect";
import { cacheDatabasePath, inspectCacheClear, deleteInspectedCache, cachePhysicalBytes } from "../../base/cache/index.ts";
import { inspectCacheStatus, type CacheStatus } from "../../base/cache/index.ts";
import { PersistentCache, closeRepositoryCache } from "../../base/cache/index.ts";
import { acquireHawdbClearGuard, hawdbIdentity, HawdbFailure } from "../../base/cache/index.ts";
import { AnnotatedCaseSchema, ConcordError, canonical, decode, digest, objectDigest, type AnnotatedCase, type AnnotationSnapshot, type Finding, type Repository } from "../../model/index.ts";
import { caseDiscriminator, deriveTestReference } from "../../model/index.ts";
import * as ts from 'typescript/ast';
import { withTypeScript, withTypeScriptSource, typescriptPackageVersion } from "../../base/process/index.ts";

// @concord-begin
// @concord-implements docs/feature/local-sdlc/use-case/discover-annotated-tests.md#标记规则
function parserVersion(): string { return `typescript-ast/${typescriptPackageVersion()}/concord-annotations-v6-issue`; }
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/;
const TEXT_LIMIT = 1_048_576;
const COMMENT_LINE = /^[ \t]*(?:\/\/+|#|--)[ \t]?(.*)$/u;
const FindingSchema = Schema.Struct({ code: Schema.String, path: Schema.String, message: Schema.String, line: Schema.optional(Schema.Int) });
const CachedSnapshotSchema = Schema.Struct({
  cases: Schema.Array(AnnotatedCaseSchema),
  findings: Schema.Array(FindingSchema),
  files: Schema.Array(Schema.Struct({ path: Schema.String, digest: Schema.String })),
  digest: Schema.String,
});
type CachedSnapshot = typeof CachedSnapshotSchema.Type;

interface Source { readonly path: string; readonly text: string; readonly digest: string }
interface Parsed { readonly cases: AnnotatedCase[]; readonly findings: Finding[] }

function finding(findings: Finding[], code: string, path: string, message: string, line?: number): void { findings.push(line === undefined ? { code, path, message } : { code, path, message, line }); }
function parseAnnotations(values: readonly string[], lines: readonly number[], path: string, findings: Finding[]): { readonly contract?: string; readonly contractKind?: 'feature' | 'use-case'; readonly contractLine?: number; readonly issues: string[]; readonly status: 'active' | 'retired'; readonly name?: string; readonly native?: string; readonly recognized: boolean; readonly rejected: boolean } {
  let contract: string | undefined, contractKind: 'feature' | 'use-case' | undefined, contractLine: number | undefined, status: 'active' | 'retired' = 'active', name: string | undefined, native: string | undefined, recognized = false, rejected = false;
  const issues: string[] = [];
  for (let index = 0; index < values.length; index++) {
    const match = /^@(feature|use-case|issue|status|name|native)(?:\s+(.+?))?\s*$/u.exec(values[index] ?? '');
    if (!match) continue;
    recognized = true;
    const kind = match[1], argument = match[2]?.trim(), line = lines[index];
    if (!argument) { finding(findings, 'InvalidAnnotation', path, `@${kind} requires a value`, line); rejected = true; continue; }
    if (kind === 'feature' || kind === 'use-case') {
      if (contract !== undefined) { finding(findings, 'DuplicateContractAnnotation', path, 'A test marker has more than one @feature/@use-case target', line); rejected = true; }
      else { contract = argument; contractKind = kind; contractLine = line; }
    } else if (kind === 'native') {
      if (native !== undefined) { finding(findings, 'InvalidAnnotation', path, '@native must appear once', line); rejected = true; }
      else native = argument;
    } else if (kind === 'issue') issues.push(argument);
    else if (kind === 'name') {
      if (name !== undefined) { finding(findings, 'InvalidAnnotation', path, '@name must appear once', line); rejected = true; }
      else name = argument;
    } else if (argument === 'retired') status = 'retired';
    else { finding(findings, 'InvalidAnnotation', path, '@status must be retired', line); rejected = true; }
  }
  return { contract, contractKind, contractLine, issues, status, name, native, recognized, rejected };
}
function realCommentLines(path: string, text: string): ReadonlySet<number> | undefined {
  if (!SOURCE_EXTENSION.test(path)) return undefined;
  return withTypeScriptSource(path, text, source => {
    const lines = new Set<number>();
    const collect = (ranges: readonly ts.CommentRange[] | undefined): void => {
      for (const range of ranges ?? []) {
        if (range.kind === ts.SyntaxKind.SingleLineCommentTrivia) lines.add(source.getLineAndCharacterOfPosition(range.pos).line + 1);
      }
    };
    // Comment ranges only. Template, string, and regex text are not markers.
    // The host test declaration is not interpreted.
    const visit = (node: ts.Node): void => {
      const children = node.getChildren(source);
      if (children.length > 0) { for (const child of children) visit(child); return; }
      collect(ts.getLeadingCommentRanges(text, node.getFullStart()));
      collect(ts.getTrailingCommentRanges(text, node.end));
    };
    visit(source);
    return lines;
  });
}
function hasTestMarker(text: string): boolean { return !text.includes('\0') && /@(?:feature|use-case|issue|status|name|native)(?:\s|$)/u.test(text); }
export function parseTestDeclarations(path: string, text: string): { readonly cases: readonly AnnotatedCase[]; readonly findings: readonly Finding[] } {
  return parseSource({ path, text, digest: digest(text) });
}

/** Locate exact whole-line Issue markers through the same real-comment parser as discovery. */
export function issueMarkerLines(path: string, text: string, issue: string): readonly number[] {
  const comments = realCommentLines(path, text);
  const lines = text.split(/\r?\n/u).flatMap((line, index) => {
    const value = COMMENT_LINE.exec(line)?.[1];
    return value !== undefined && /^@issue\s+(.+?)\s*$/u.exec(value)?.[1] === issue && (comments === undefined || comments.has(index + 1)) ? [index + 1] : [];
  });
  if (!lines.length) return [];
  const parsed = parseTestDeclarations(path, text);
  if (parsed.findings.length || !parsed.cases.some(item => item.issues.includes(issue))) throw new ConcordError('InvalidAnnotation', `Cannot safely remove Issue markers from ${path}`, parsed.findings);
  return lines;
}

function parseSource(input: Source): Parsed {
  if (!hasTestMarker(input.text)) return { cases: [], findings: [] };
  const comments = realCommentLines(input.path, input.text);
  const lines = input.text.split(/\r?\n/u);
  const findings: Finding[] = [], cases: AnnotatedCase[] = [];
  const ordinals = new Map<string, number>();
  let index = 0;
  while (index < lines.length) {
    const comment = COMMENT_LINE.exec(lines[index] ?? '');
    const lineNumber = index + 1;
    if (!comment || (comments !== undefined && !comments.has(lineNumber))) { index++; continue; }
    const values: string[] = [], valueLines: number[] = [];
    while (index < lines.length) {
      const next = COMMENT_LINE.exec(lines[index] ?? '');
      const nextLine = index + 1;
      if (!next || (comments !== undefined && !comments.has(nextLine))) break;
      values.push(next[1] ?? '');
      valueLines.push(nextLine);
      index++;
    }
    const parsed = parseAnnotations(values, valueLines, input.path, findings);
    const markerLine = valueLines[0] ?? lineNumber;
    if (!parsed.recognized) continue;
    if (parsed.rejected || parsed.contract === undefined || parsed.contractKind === undefined || parsed.contractLine === undefined) {
      if (!parsed.rejected) finding(findings, 'MissingContract', input.path, 'Concord test marker is missing @feature or @use-case', markerLine);
      continue;
    }
    const ordinal = ordinals.get(parsed.contract) ?? 0;
    if (parsed.name === undefined) ordinals.set(parsed.contract, ordinal + 1);
    const name = parsed.name ?? caseDiscriminator(parsed.contract, ordinal);
    const id = deriveTestReference(input.path, input.path, name);
    try {
      cases.push(decode(AnnotatedCaseSchema, {
        id, file: input.path, line: parsed.contractLine, name, contract: parsed.contract, contractKind: parsed.contractKind,
        issues: parsed.issues, status: parsed.status, framework: 'marker', skipped: false, named: parsed.name !== undefined, ...(parsed.native === undefined ? {} : { native: parsed.native }),
        markerEndLine: valueLines.filter((_, index) => /^@(feature|use-case|issue|status|name|native)(?:\s|$)/u.test(values[index] ?? '')).at(-1),
      }, `${input.path}:${parsed.contractLine}`));
    } catch (cause) { finding(findings, 'InvalidAnnotation', input.path, cause instanceof Error ? cause.message : String(cause), parsed.contractLine); }
  }
  return { cases, findings };
}
// @concord-end

type SourceMode = 'disk' | 'overlay';
// @concord-begin
// @concord-implements docs/feature/local-sdlc/use-case/discover-annotated-tests.md#list
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md#hit
function sources(repo: Repository, mode: SourceMode): Source[] {
  const paths = [...new Set(repo.config.testRoots.flatMap(root => repo.files(root, 'source')))].sort();
  const selected: Source[] = [];
  for (const path of paths) {
    let stat: ReturnType<typeof snapshotMetadata> = undefined;
    if (mode === 'disk' && repo.inspect !== undefined) {
      // The scoped metadata read already verifies the root and every ancestor.
      // Keep that proof outside the skippable metadata failure boundary.
      stat = snapshotMetadata(repo, path);
    } else {
      repo.absolute(path);
      if (mode === 'disk') { try { stat = snapshotMetadata(repo, path); } catch { continue; } }
    }
    if (mode === 'disk' && (stat === undefined || !stat.file || stat.symbolicLink || stat.size > TEXT_LIMIT)) continue;
    const text = repo.read(path);
    if (text === undefined) throw new ConcordError('SourceChanged', `${path} disappeared while it was scanned`);
    if (Buffer.byteLength(text) > TEXT_LIMIT) continue;
    if (text.includes('\0')) continue;
    selected.push({ path, text, digest: digest(text) });
  }
  return selected;
}
function cachePath(repo: Repository): string { return cacheDatabasePath(repo.privateDir); }
function cacheKey(repo: Repository, current: readonly Source[]): string {
  return objectDigest({ root: repo.root, privateDir: repo.privateDir, config: repo.config, parser: parserVersion(), files: current.map(source => ({ path: source.path, digest: source.digest })) });
}
function readCache(repo: Repository, key: string): CachedSnapshot | undefined {
  return (() => {
    const db = PersistentCache.repository(repo);
    const row = db?.get('annotation_cache', [key])[0];
    if (row === undefined) return undefined;
    const value = decode(CachedSnapshotSchema, JSON.parse(row.payload), 'annotation cache');
    if (value.digest !== objectDigest({ cases: value.cases, findings: value.findings, files: value.files })) throw new ConcordError('InvalidData', 'annotation cache digest does not match its payload');
    return value;
  })();
}
function writeCache(repo: Repository, key: string, value: CachedSnapshot): void {
  PersistentCache.repository(repo).put('annotation_cache', [{ key, payload: canonical(value) }]);
}
function unchanged(repo: Repository, before: readonly Source[], mode: SourceMode): boolean {
  try { const after = sources(repo, mode); return after.length === before.length && after.every((source, index) => source.path === before[index]?.path && source.digest === before[index]?.digest); } catch { return false; }
}
function compile(current: readonly Source[]): CachedSnapshot {
  const parse = () => current.map(parseSource);
  const parsed = current.some(input => SOURCE_EXTENSION.test(input.path) && hasTestMarker(input.text)) ? withTypeScript(parse) : parse();
  const cases = parsed.flatMap(result => result.cases).sort((a, b) => a.id.localeCompare(b.id) || a.file.localeCompare(b.file) || a.line - b.line);
  const findings = parsed.flatMap(result => result.findings);
  const ids = new Map<string, AnnotatedCase>();
  for (const item of cases) { const prior = ids.get(item.id); if (prior) { findings.push({ code: 'DuplicateCaseId', path: item.file, line: item.line, message: `Case ID ${item.id} is also declared at ${prior.file}:${prior.line}` }); } else ids.set(item.id, item); }
  const files = current.map(source => ({ path: source.path, digest: source.digest }));
  const orderedFindings = findings.sort((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0) || a.code.localeCompare(b.code));
  return { cases, findings: orderedFindings, files, digest: objectDigest({ cases, findings: orderedFindings, files }) };
}
function snapshot(value: CachedSnapshot, cache: AnnotationSnapshot['cache']): AnnotationSnapshot { return { ...value, cache }; }
function sourceChanged(value: CachedSnapshot, cache: AnnotationSnapshot['cache']): AnnotationSnapshot {
  return snapshot({ ...value, findings: [...value.findings, { code: 'SourceChanged', path: '.', message: 'Source files changed while annotations were scanned' }] }, cache);
}
const cacheFailureDetail = (cause: unknown): string => cause instanceof HawdbFailure && cause.code === 'HawdbBusy'
  ? `${cause.code}: ${cause.message}` : cause instanceof Error ? cause.message : String(cause);

export function scanAnnotations(repo: Repository, options: { cache?: 'use' | 'rebuild' | 'off'; sourceMode?: SourceMode } = {}): AnnotationSnapshot {
  return repo.snapshot === undefined ? scanUnderSnapshot(repo, options) : repo.snapshot(() => scanUnderSnapshot(repo, options));
}
function scanUnderSnapshot(repo: Repository, options: { cache?: 'use' | 'rebuild' | 'off'; sourceMode?: SourceMode }): AnnotationSnapshot {
  const mode = options.cache ?? 'use', sourceMode = options.sourceMode ?? 'disk', path = cachePath(repo);
  if (sourceMode === 'overlay' && mode !== 'off') throw new ConcordError('InvalidOption', 'Overlay annotation sources require cache: off');
  const current = sources(repo, sourceMode); const key = cacheKey(repo, current);
  if (mode === 'off') { const value = compile(current); return unchanged(repo, current, sourceMode) ? snapshot(value, { status: 'off', hits: 0, misses: 1, path }) : sourceChanged(value, { status: 'source-changed', hits: 0, misses: 1, path }); }
  if (mode === 'use') try {
    const cached = readCache(repo, key);
    if (cached) return unchanged(repo, current, sourceMode) ? snapshot(cached, { status: 'hit', hits: 1, misses: 0, path }) : sourceChanged(compile(current), { status: 'source-changed', hits: 0, misses: 1, path });
  } catch (cause) { const value = compile(current); return unchanged(repo, current, sourceMode) ? snapshot(value, { status: 'unavailable', hits: 0, misses: 1, path, detail: cacheFailureDetail(cause) }) : sourceChanged(value, { status: 'source-changed', hits: 0, misses: 1, path }); }
  const value = compile(current);
  if (!unchanged(repo, current, sourceMode)) return sourceChanged(value, { status: 'source-changed', hits: 0, misses: 1, path });
  try { writeCache(repo, key, value); return snapshot(value, { status: 'miss', hits: 0, misses: 1, path }); }
  catch (cause) { return snapshot(value, { status: 'unavailable', hits: 0, misses: 1, path, detail: cacheFailureDetail(cause) }); }
}
// @concord-end

// @concord-begin
// @concord-implements docs/feature/local-sdlc/use-case/discover-annotated-tests.md#rebuild
export function clearCache(repo: Repository, onlyAboveBytes?: number, runtime: RuntimeEnvironmentSnapshot = repositoryRuntime(repo)): { readonly status: string; readonly path: string } {
  return repo.snapshot === undefined ? clearUnderSnapshot(repo, onlyAboveBytes, runtime) : repo.snapshot(() => clearUnderSnapshot(repo, onlyAboveBytes, runtime));
}
export function previewCacheClear(repo: Repository, runtime: RuntimeEnvironmentSnapshot = repositoryRuntime(repo)) {
  const preview = () => {
    const inventory = inspectCacheClear(repo.privateDir);
    let native: { status: 'ready' | 'unavailable'; detail?: string };
    try { hawdbIdentity(runtime); native = { status: 'ready' }; }
    catch (cause) { native = { status: 'unavailable', detail: cause instanceof Error ? cause.message : String(cause) }; }
    return {
      operation: 'cache-clear' as const, dryRun: true as const, engine: 'hawdb' as const,
      path: inventory.path, existing: inventory.existing, remove: inventory.entries,
      preserve: [inventory.path, `${inventory.path}/owner.hawdb.lock`, `${inventory.path}.concord.lock`], native,
      ownership: 'checked-on-execution' as const,
    };
  };
  return repo.snapshot === undefined ? preview() : repo.snapshot(preview);
}
function clearUnderSnapshot(repo: Repository, onlyAboveBytes: number | undefined, runtime: RuntimeEnvironmentSnapshot): { readonly status: string; readonly path: string } {
  if (repo.access === 'read') throw new ConcordError('ReadOnlyRepository', 'Cache clear requires write access');
  const inventory = inspectCacheClear(repo.privateDir);
  if (!inventory.existing) return { status: 'empty', path: inventory.path };
  closeRepositoryCache(repo);
  const guard = acquireHawdbClearGuard(inventory.path, runtime);
  try {
    guard.verify();
    if (onlyAboveBytes !== undefined && cachePhysicalBytes(repo.privateDir) <= onlyAboveBytes) return { status: 'below-limit', path: inventory.path };
    deleteInspectedCache(inspectCacheClear(repo.privateDir), () => guard.verify());
  }
  finally { guard.close(); }
  return { status: inventory.empty ? 'empty' : 'cleared', path: inventory.path };
}
export function cacheStatus(repo: Repository, runtime: RuntimeEnvironmentSnapshot = repositoryRuntime(repo)): CacheStatus {
  const inspect = () => inspectCacheStatus(repo.privateDir, repo.persistentCache !== 'off', () => PersistentCache.repository(repo), () => closeRepositoryCache(repo), runtime);
  return repo.snapshot === undefined ? inspect() : repo.snapshot(inspect);
}
// @concord-end
