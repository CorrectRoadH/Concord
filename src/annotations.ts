// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/discover-annotated-tests.md
import { lstatSync } from 'node:fs';
import { Schema } from 'effect';
import { cacheDatabasePath, assertCacheDatabaseSafe, inspectCacheClear, deleteInspectedCache, prepareCacheClearRoot } from './cache-file.js';
import { withPersistentCache, closeRepositoryCache } from './cache-store.js';
import { acquireHawdbClearGuard } from './hawdb-native.js';
import { AnnotatedCaseSchema, ConcordError, canonical, decode, digest, objectDigest, type AnnotatedCase, type AnnotationSnapshot, type Finding, type Repository } from './shared.js';
import { caseDiscriminator, deriveTestReference } from './test-reference.js';
import type * as TypeScript from 'typescript';
import { lazyTypeScript } from './typescript-host.js';

function parserVersion(): string { return 'concord-annotations-v4-marker'; }
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
function parseAnnotations(values: readonly string[], lines: readonly number[], path: string, findings: Finding[]): { readonly contract?: string; readonly contractKind?: 'feature' | 'use-case'; readonly contractLine?: number; readonly regressions: string[]; readonly status: 'active' | 'retired'; readonly name?: string; readonly recognized: boolean; readonly rejected: boolean } {
  let contract: string | undefined, contractKind: 'feature' | 'use-case' | undefined, contractLine: number | undefined, status: 'active' | 'retired' = 'active', name: string | undefined, recognized = false, rejected = false;
  const regressions: string[] = [];
  for (let index = 0; index < values.length; index++) {
    const match = /^@(feature|use-case|regression|status|name)(?:\s+(.+?))?\s*$/u.exec(values[index] ?? '');
    if (!match) continue;
    recognized = true;
    const kind = match[1], argument = match[2]?.trim(), line = lines[index];
    if (!argument) { finding(findings, 'InvalidAnnotation', path, `@${kind} requires a value`, line); rejected = true; continue; }
    if (kind === 'feature' || kind === 'use-case') {
      if (contract !== undefined) { finding(findings, 'DuplicateContractAnnotation', path, 'A test marker has more than one @feature/@use-case target', line); rejected = true; }
      else { contract = argument; contractKind = kind; contractLine = line; }
    } else if (kind === 'regression') regressions.push(argument);
    else if (kind === 'name') {
      if (name !== undefined) { finding(findings, 'InvalidAnnotation', path, '@name must appear once', line); rejected = true; }
      else name = argument;
    } else if (argument === 'retired') status = 'retired';
    else { finding(findings, 'InvalidAnnotation', path, '@status must be retired', line); rejected = true; }
  }
  return { contract, contractKind, contractLine, regressions, status, name, recognized, rejected };
}
function realCommentLines(path: string, text: string): ReadonlySet<number> | undefined {
  if (!SOURCE_EXTENSION.test(path)) return undefined;
  const ts = lazyTypeScript();
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const lines = new Set<number>();
  const collect = (ranges: readonly TypeScript.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) {
      if (range.kind === ts.SyntaxKind.SingleLineCommentTrivia) lines.add(source.getLineAndCharacterOfPosition(range.pos).line + 1);
    }
  };
  // Comment ranges only. Template, string, and regex text are not markers.
  // The host test declaration is not interpreted.
  const visit = (node: TypeScript.Node): void => {
    const children = node.getChildren(source);
    if (children.length > 0) { for (const child of children) visit(child); return; }
    collect(ts.getLeadingCommentRanges(text, node.getFullStart()));
    collect(ts.getTrailingCommentRanges(text, node.end));
  };
  visit(source);
  return lines;
}
export function parseTestDeclarations(path: string, text: string): { readonly cases: readonly AnnotatedCase[]; readonly findings: readonly Finding[] } {
  return parseSource({ path, text, digest: digest(text) });
}

function parseSource(input: Source): Parsed {
  if (input.text.includes('\0')) return { cases: [], findings: [] };
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
        regressions: parsed.regressions, status: parsed.status, framework: 'marker', skipped: false, named: parsed.name !== undefined,
      }, `${input.path}:${parsed.contractLine}`));
    } catch (cause) { finding(findings, 'InvalidAnnotation', input.path, cause instanceof Error ? cause.message : String(cause), parsed.contractLine); }
  }
  return { cases, findings };
}

function sources(repo: Repository): Source[] {
  const paths = [...new Set(repo.config.testRoots.flatMap(root => repo.files(root)))].sort();
  const selected: Source[] = [];
  for (const path of paths) {
    const absolute = repo.absolute(path);
    let stat;
    try { stat = lstatSync(absolute); } catch { continue; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > TEXT_LIMIT) continue;
    const text = repo.read(path);
    if (text === undefined) throw new ConcordError('SourceChanged', `${path} disappeared while it was scanned`);
    if (text.includes('\0')) continue;
    selected.push({ path, text, digest: digest(text) });
  }
  return selected;
}
function cachePath(repo: Repository): string { return cacheDatabasePath(repo.privateDir); }
function cacheKey(repo: Repository, current: readonly Source[]): string {
  return objectDigest({ projectId: repo.config.projectId, root: repo.root, privateDir: repo.privateDir, config: repo.config, parser: parserVersion(), files: current.map(source => ({ path: source.path, digest: source.digest })) });
}
function readCache(repo: Repository, key: string): CachedSnapshot | undefined {
  return withPersistentCache(repo, false, db => {
    const row = db?.get('annotation_cache', [key])[0];
    if (row === undefined) return undefined;
    const value = decode(CachedSnapshotSchema, JSON.parse(row.payload), 'annotation cache');
    if (value.digest !== objectDigest({ cases: value.cases, findings: value.findings, files: value.files })) throw new ConcordError('InvalidData', 'annotation cache digest does not match its payload');
    return value;
  });
}
function writeCache(repo: Repository, key: string, value: CachedSnapshot): void {
  withPersistentCache(repo, true, db => db!.put('annotation_cache', [{ key, payload: canonical(value) }]));
}
function unchanged(repo: Repository, before: readonly Source[]): boolean {
  try { const after = sources(repo); return after.length === before.length && after.every((source, index) => source.path === before[index]?.path && source.digest === before[index]?.digest); } catch { return false; }
}
function compile(current: readonly Source[]): CachedSnapshot {
  const parsed = current.map(parseSource);
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

// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/discover-annotated-tests.md
export function scanAnnotations(repo: Repository, options: { cache?: 'use' | 'rebuild' | 'off' } = {}): AnnotationSnapshot {
  return repo.snapshot === undefined ? scanUnderSnapshot(repo, options) : repo.snapshot(() => scanUnderSnapshot(repo, options));
}
function scanUnderSnapshot(repo: Repository, options: { cache?: 'use' | 'rebuild' | 'off' }): AnnotationSnapshot {
  const mode = options.cache ?? 'use', path = cachePath(repo); const current = sources(repo); const key = cacheKey(repo, current);
  if (mode === 'off') { const value = compile(current); return unchanged(repo, current) ? snapshot(value, { status: 'off', hits: 0, misses: 1, path }) : sourceChanged(value, { status: 'source-changed', hits: 0, misses: 1, path }); }
  if (mode === 'use') try {
    const cached = readCache(repo, key);
    if (cached) return unchanged(repo, current) ? snapshot(cached, { status: 'hit', hits: 1, misses: 0, path }) : sourceChanged(compile(current), { status: 'source-changed', hits: 0, misses: 1, path });
  } catch (cause) { const value = compile(current); return unchanged(repo, current) ? snapshot(value, { status: 'unavailable', hits: 0, misses: 1, path, detail: cause instanceof Error ? cause.message : String(cause) }) : sourceChanged(value, { status: 'source-changed', hits: 0, misses: 1, path }); }
  const value = compile(current);
  if (!unchanged(repo, current)) return sourceChanged(value, { status: 'source-changed', hits: 0, misses: 1, path });
  try { writeCache(repo, key, value); return snapshot(value, { status: 'miss', hits: 0, misses: 1, path }); }
  catch (cause) { return snapshot(value, { status: 'unavailable', hits: 0, misses: 1, path, detail: cause instanceof Error ? cause.message : String(cause) }); }
}

export function clearCache(repo: Repository): { readonly status: string; readonly path: string } {
  return repo.snapshot === undefined ? clearUnderSnapshot(repo) : repo.snapshot(() => clearUnderSnapshot(repo));
}
function clearUnderSnapshot(repo: Repository): { readonly status: string; readonly path: string } {
  const inventory = inspectCacheClear(repo.privateDir);
  if (!inventory.existing && inventory.legacy.length === 0) return { status: 'empty', path: inventory.path };
  closeRepositoryCache(repo);
  prepareCacheClearRoot(inventory);
  const guard = acquireHawdbClearGuard(inventory.path);
  try { deleteInspectedCache(inspectCacheClear(repo.privateDir)); }
  finally { guard.close(); }
  return { status: inventory.empty ? 'empty' : 'cleared', path: inventory.path };
}
export function cacheStatus(repo: Repository): { readonly status: string; readonly path: string; readonly detail?: string } {
  return repo.snapshot === undefined ? statusUnderSnapshot(repo) : repo.snapshot(() => statusUnderSnapshot(repo));
}
function statusUnderSnapshot(repo: Repository): { readonly status: string; readonly path: string; readonly detail?: string } {
  const path = cachePath(repo); try {
    const inventory = inspectCacheClear(repo.privateDir);
    if (inventory.legacy.length > 0) return { status: 'unavailable', path, detail: 'Legacy SQLite cache remnants require explicit clear' };
    if (!assertCacheDatabaseSafe(path) || inventory.empty) return { status: 'empty', path };
    return withPersistentCache(repo, false, db => {
      const projections = db!.namespaces().filter(name => name.endsWith('_cache'));
      for (const namespace of projections) db!.scan(namespace);
      return { status: projections.length === 0 ? 'empty' : 'ready', path, detail: `projections: ${projections.join(', ')}` };
    });
  } catch (cause) { return { status: 'unavailable', path, detail: cause instanceof Error ? cause.message : String(cause) }; }
}
