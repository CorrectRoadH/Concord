import { readFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { Effect, Predicate, Schema } from 'effect';
import { parseDocument, stringify as stringifyYaml } from 'yaml';
import { decode, digest, MemorySchema, type MemoryMeta } from '../src/shared.js';

const execFile = promisify(execFileCallback);

export interface MemoryMigrationPart {
  readonly changes: readonly { readonly path: string; readonly before: string | null; readonly after: string | null }[];
  readonly audit: readonly {
    readonly sourcePath: string;
    readonly targetPath: string;
    readonly sourceDigest: string;
    readonly bodyDigest: string;
    readonly sourceMetadata: unknown;
  }[];
}

const NullableString = Schema.NullOr(Schema.String);
const Kind = Schema.NullOr(Schema.Literals(['problem', 'decision', 'insight']));
const State = Schema.NullOr(Schema.Literals(['resolved', 'open', 'superseded', 'current', 'adopted']));
const Evidence = Schema.Struct({
  status: Schema.String,
  source: Schema.String,
  reason: Schema.String,
  explicitSignals: Schema.Array(Schema.String),
});
const CreatedAt = Schema.Struct({
  value: Schema.String,
  commit: Schema.optional(Schema.String),
  source: Schema.String,
});
const PromotionHistory = Schema.Struct({ target: Schema.String, commit: Schema.String });
const ManifestRecordSchema = Schema.Struct({
  path: Schema.String,
  title: Schema.String,
  currentKind: Kind,
  currentState: State,
  migratedKind: Kind,
  migratedStateFact: State,
  classificationEvidence: Schema.Array(Schema.Unknown),
  format: Schema.NullOr(Schema.String),
  diagnostic: Schema.NullOr(Schema.String),
  resolutionProofOriginal: Schema.Array(Schema.String),
  bodyProofSectionsOriginal: Schema.Array(Schema.Unknown),
  promotionCurrent: Schema.Array(Schema.String),
  promotionHistory: Schema.Array(PromotionHistory),
  createdAt: CreatedAt,
  classificationReview: Schema.optional(Schema.String),
  stateEvidence: Schema.optional(Evidence),
  sourceDigest: Schema.String,
  bodyDigest: Schema.String,
  originalMetadataRaw: Schema.optional(Schema.String),
  originalMetadata: Schema.optional(Schema.Unknown),
  metadataAudit: Schema.optional(Schema.Unknown),
  partialSupersession: Schema.optional(Schema.Unknown),
  descriptionReview: Schema.optional(Schema.Unknown),
});
const ManifestSchema = Schema.Struct({
  format: Schema.Literal('niceeval.memory-migration-manifest/v1'),
  source: Schema.Struct({ repository: Schema.String, root: Schema.String, excluded: Schema.Array(Schema.String), recordCount: Schema.Int }),
  summary: Schema.Unknown,
  records: Schema.Array(ManifestRecordSchema),
});
type ManifestRecord = typeof ManifestRecordSchema.Type;
type Manifest = typeof ManifestSchema.Type;

class MigrationError extends Error {
  readonly name = 'MigrationError';
  constructor(message: string, readonly details?: unknown) { super(message); }
}

interface Frontmatter {
  readonly raw: string | null;
  readonly metadata: unknown;
  readonly body: Buffer;
}

function splitFrontmatter(bytes: Buffer): Frontmatter {
  const lineAt = (offset: number): { readonly end: number; readonly text: string } | null => {
    if (offset >= bytes.length) return null;
    let end = offset;
    while (end < bytes.length && bytes[end] !== 10) end += 1;
    return { end: end < bytes.length ? end + 1 : end, text: bytes.subarray(offset, end).toString('utf8').replace(/\r$/, '') };
  };
  const first = lineAt(0);
  if (!first || first.text !== '---') return { raw: null, metadata: null, body: bytes };
  let cursor = first.end;
  while (cursor <= bytes.length) {
    const line = lineAt(cursor);
    if (!line) break;
    if (line.text === '---') {
      const raw = bytes.subarray(first.end, cursor).toString('utf8');
      const document = parseDocument(raw, { uniqueKeys: true, merge: false });
      const metadata = document.errors.length === 0 ? document.toJS({ maxAliasCount: 0 }) : null;
      return { raw, metadata, body: bytes.subarray(line.end) };
    }
    cursor = line.end;
  }
  return { raw: null, metadata: null, body: bytes };
}

const ObjectSchema = Schema.Record(Schema.String, Schema.Unknown);
function objectValue(value: unknown): Readonly<Record<string, unknown>> {
  try { return Schema.decodeUnknownSync(ObjectSchema, { onExcessProperty: 'ignore' })(value); }
  catch { return {}; }
}
function stringValue(value: unknown): string | undefined { return Predicate.isString(value) && value.length > 0 ? value : undefined; }

function currentHead(root: string): Effect.Effect<string, Error> {
  return Effect.tryPromise({
    try: async () => {
      const env = { ...process.env };
      for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
      const result = await execFile('git', ['-C', root, 'rev-parse', 'HEAD'], { env });
      const commit = result.stdout.trim();
      if (!/^[0-9a-f]{40}$/.test(commit)) throw new MigrationError(`invalid current HEAD for ${root}`);
      return commit;
    },
    catch: cause => cause instanceof Error ? cause : new Error(String(cause)),
  });
}

interface SourceRef { readonly path: string; readonly commit: string; readonly digest: string }
interface Statement { readonly statement: string; readonly source: SourceRef }

function explicitRepair(line: string): boolean {
  return /已修(?:复)?|已经修复|已定位并修复|fixed/i.test(line) && !/^\s*#{1,6}\s*(?:修法|修正|fix|resolution)/i.test(line);
}

function indexEntryFor(record: ManifestRecord, index: string): readonly string[] {
  const basename = path.basename(record.path);
  return index.split(/\r?\n/).filter(line => line.includes(record.path) || line.includes(basename));
}

function sourceReason(record: ManifestRecord, metadata: Readonly<Record<string, unknown>>): string {
  const resolution = objectValue(objectValue(metadata.kind).resolution);
  return stringValue(resolution.reason) ?? record.stateEvidence?.reason ?? '保留原记录声明';
}

function attestationStatement(
  record: ManifestRecord,
  metadata: Readonly<Record<string, unknown>>,
  sourceRaw: string | null,
  body: string,
  index: string,
  source: SourceRef,
  indexRef: SourceRef,
): Statement {
  const resolution = objectValue(objectValue(metadata.kind).resolution);
  const attestation = objectValue(resolution.attestation);
  const declared = stringValue(attestation.statement);
  if (declared) return { statement: declared, source };
  const description = stringValue(metadata.description);
  if (description && explicitRepair(description)) return { statement: description, source };
  if (Object.keys(resolution).length > 0 && sourceRaw !== null) {
    const lines = sourceRaw.split(/\r?\n/);
    const start = lines.findIndex(line => /^kind:\s*$/.test(line) || /^  resolution:\s*$/.test(line));
    const end = start >= 0 ? lines.findIndex((line, index) => index > start && /^(?:promotions|metadata):/.test(line)) : -1;
    const declaration = lines.slice(start >= 0 ? start : 0, end > start ? end : lines.length).join('\n').trim();
    if (declaration.length > 0) return { statement: declaration, source };
  }
  const bodyLine = body.split(/\r?\n/).find(line => explicitRepair(line.trim()));
  if (bodyLine) return { statement: bodyLine.trim(), source };
  const indexLine = indexEntryFor(record, index).find(line => explicitRepair(line.trim()));
  if (indexLine) return { statement: indexLine.trim(), source: indexRef };
  throw new MigrationError(`${record.path}: resolved state has no named original repair declaration`);
}

function directSupersededTarget(record: ManifestRecord, metadata: Readonly<Record<string, unknown>>, body: string, index: string): { readonly id: string; readonly evidence: string } | undefined {
  const declared = stringValue(metadata.supersededBy);
  if (declared) {
    const id = declared.replace(/^memory\//, '').replace(/\.md$/, '');
    if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) return { id, evidence: `original metadata supersededBy=${declared}` };
  }
  for (const line of [...body.split(/\r?\n/), ...indexEntryFor(record, index)]) {
    const match = /被[^\n]{0,80}?(?:\[\[([a-z0-9]+(?:-[a-z0-9]+)*)\]\]|\[[^\]]+\]\(([^)#/]+)\.md(?:#[^)]*)?\))[^\n]{0,40}(?:替代|取代|推翻)/.exec(line);
    const id = match?.[1] ?? match?.[2];
    if (id) return { id, evidence: line.trim() };
  }
  return undefined;
}

function stateFor(record: ManifestRecord): 'captured' | 'open' | 'resolved' | 'current' | 'superseded' {
  const fact = record.migratedStateFact;
  if (fact === 'adopted') return 'current';
  if (fact === 'resolved' || fact === 'open' || fact === 'current' || fact === 'superseded') return fact;
  return 'captured';
}

function migrationResolution(record: ManifestRecord, metadata: Readonly<Record<string, unknown>>, sourceRaw: string | null, body: string, index: string, at: string, source: SourceRef, indexRef: SourceRef): Record<string, unknown> | undefined {
  const state = stateFor(record);
  const originalKind = objectValue(objectValue(metadata.kind).resolution).kind;
  if (state !== 'resolved' || record.migratedKind !== 'problem') return undefined;
  const kind = originalKind === 'not-a-bug' || originalKind === 'wont-fix' || originalKind === 'external-fixed' ? originalKind : 'fixed';
  const statement = attestationStatement(record, metadata, sourceRaw, body, index, source, indexRef);
  return {
    kind,
    evidenceLevel: 'attested',
    reason: sourceReason(record, metadata),
    at,
    epoch: 0,
    attestation: {
      statement: statement.statement,
      proof: record.resolutionProofOriginal,
      source: statement.source,
    },
  };
}

function supersessionStatement(record: ManifestRecord, body: string, index: string, source: SourceRef, indexRef: SourceRef): Statement {
  const indexLine = indexEntryFor(record, index).find(line => /被[^\n]{0,100}(?:替代|取代|推翻)/.test(line));
  if (indexLine) return { statement: indexLine.trim(), source: indexRef };
  const bodyLine = body.split(/\r?\n/).find(line => /被[^\n]{0,100}(?:替代|取代|推翻)/.test(line));
  if (bodyLine) return { statement: bodyLine.trim(), source };
  throw new MigrationError(`${record.path}: superseded state has no direct original replacement statement`);
}

function supersessionHistory(record: ManifestRecord, body: string, at: string, statement: Statement): Record<string, unknown> {
  const eventAt = body.match(/(?:状态|日期|裁决)[^0-9]{0,30}(20[0-9]{2}-[0-9]{2}-[0-9]{2})/)?.[1];
  const references = [...body.matchAll(/\[[^\]]+\]\([^)]+\)/g)].slice(0, 2).map(match => match[0]);
  const reason = [statement.statement, ...references].join(' ');
  return { at, action: 'supersede', reason, source: statement.source, ...(eventAt ? { eventAt } : {}) };
}

function targetMetadata(record: ManifestRecord, sourceMetadata: Readonly<Record<string, unknown>>, sourceRaw: string | null, body: string, index: string, at: string, source: SourceRef, indexRef: SourceRef, knownKinds: ReadonlyMap<string, string | null>): MemoryMeta {
  const id = record.path.replace(/^memory\//, '').replace(/\.md$/, '');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new MigrationError(`source path is not a memory slug: ${record.path}`);
  const currentState = stateFor(record);
  const history: Record<string, unknown>[] = record.promotionHistory.map(promotion => ({ at, action: 'retire-promotion', reason: '保留原 promotion history；迁移为历史 retire 记录。', ref: promotion.target, commit: promotion.commit }));
  if (currentState === 'superseded') {
    if (record.promotionCurrent.length > 0) throw new MigrationError(`${record.path}: superseded record still has current promotions; refusing to invent retire history`);
    const statement = supersessionStatement(record, body, index, source, indexRef);
    history.push(supersessionHistory(record, body, at, statement));
    const resolution = Object.keys(objectValue(objectValue(sourceMetadata.kind).resolution)).length === 0 ? undefined : migrationResolution({ ...record, migratedStateFact: 'resolved' }, sourceMetadata, sourceRaw, body, index, at, source, indexRef);
    if (resolution) history.push({ at, action: 'retire', reason: '原记录的 current resolution 随记录 superseded，完整移入历史。', resolution });
  }
  const metadata: Record<string, unknown> = {
    format: 'concord.document/v1',
    id,
    title: record.title,
    createdAt: record.createdAt.value,
    kind: 'memory',
    memoryKind: record.migratedKind ?? 'note',
    state: currentState,
    epoch: 0,
    promotions: currentState === 'superseded' ? [] : record.promotionCurrent,
    history,
  };
  if (record.createdAt.source === 'git-first-record' && record.createdAt.commit) metadata.createdAtSource = { kind: 'first-recorded', path: record.path, commit: record.createdAt.commit };
  const description = stringValue(sourceMetadata.description);
  if (description) metadata.description = description;
  const resolution = migrationResolution(record, sourceMetadata, sourceRaw, body, index, at, source, indexRef);
  if (resolution) metadata.resolution = resolution;
  if (currentState === 'superseded') {
    const direct = directSupersededTarget(record, sourceMetadata, body, index);
    if (direct && knownKinds.get(direct.id) === record.migratedKind && direct.id !== id) metadata.supersededBy = `memory/${direct.id}.md`;
    else metadata.supersession = supersessionStatement(record, body, index, source, indexRef);
  }
  const partial = objectValue(record.partialSupersession);
  const partialStatement = stringValue(partial.statement);
  const partialSource = objectValue(partial.source);
  if (currentState === 'current' && partialStatement && stringValue(partialSource.path) && stringValue(partialSource.commit) && stringValue(partialSource.digest)) {
    const eventAt = partialStatement.match(/20[0-9]{2}-[0-9]{2}-[0-9]{2}/)?.[0];
    history.push({ at, action: 'revise', reason: partialStatement, source: partialSource, ...(eventAt ? { eventAt } : {}) });
  }
  return decode(MemorySchema, metadata, `migration target ${record.path}`);
}

function readManifest(manifestPath: string): Effect.Effect<Manifest, Error> {
  return Effect.tryPromise({
    try: async () => decode(ManifestSchema, JSON.parse(await readFile(manifestPath, 'utf8')), manifestPath),
    catch: cause => cause instanceof Error ? cause : new Error(String(cause)),
  });
}

export function prepareMemoryMigration(root: string, manifestPath: string, at: string, incremental = false): Effect.Effect<MemoryMigrationPart, Error> {
  return Effect.gen(function* () {
    const manifest = yield* readManifest(manifestPath);
    const expected = incremental ? manifest.source.recordCount : 551;
    if (expected < 1 || manifest.source.recordCount !== expected || manifest.records.length !== expected) return yield* Effect.fail(new MigrationError(`expected exactly ${expected} records, got ${manifest.records.length}`));
    if (path.resolve(manifest.source.root) !== path.resolve(root)) return yield* Effect.fail(new MigrationError('manifest root differs from the requested repository'));
    const head = yield* currentHead(root);
    const index = yield* Effect.tryPromise({ try: () => readFile(`${root}/memory/INDEX.md`, 'utf8'), catch: cause => cause instanceof Error ? cause : new Error(String(cause)) });
    const ids = new Set(manifest.records.map(record => record.path.replace(/^memory\//, '').replace(/\.md$/, '')));
    const knownKinds = new Map(manifest.records.map(record => [record.path.replace(/^memory\//, '').replace(/\.md$/, ''), record.migratedKind]));
    if (ids.size !== manifest.records.length || ids.has('INDEX')) return yield* Effect.fail(new MigrationError('manifest paths must be unique and must exclude memory/INDEX.md'));
    const changes: { readonly path: string; readonly before: string | null; readonly after: string | null }[] = [];
    const audit: { readonly sourcePath: string; readonly targetPath: string; readonly sourceDigest: string; readonly bodyDigest: string; readonly sourceMetadata: unknown }[] = [];
    for (const record of manifest.records) {
      if (!record.path.startsWith('memory/') || record.path.includes('..') || record.path.includes('\\')) return yield* Effect.fail(new MigrationError(`unsafe source path ${record.path}`));
      const full = yield* Effect.tryPromise({ try: () => readFile(`${root}/${record.path}`), catch: cause => cause instanceof Error ? cause : new Error(String(cause)) });
      const parts = splitFrontmatter(full);
      const sourceDigest = digest(full);
      const bodyDigest = digest(parts.body);
      if (sourceDigest !== record.sourceDigest || bodyDigest !== record.bodyDigest) return yield* Effect.fail(new MigrationError(`manifest CAS mismatch for ${record.path}`));
      const metadata = objectValue(parts.metadata);
      if (incremental) {
        const kind = objectValue(metadata.kind);
        const promotions = decode(Schema.Array(Schema.Struct({
          kind: Schema.String, current: Schema.Array(Schema.String), history: Schema.Array(PromotionHistory),
        })), metadata.promotions, `${record.path}: legacy promotions`);
        const proof = decode(Schema.Array(Schema.String), objectValue(kind.resolution).proof ?? [], `${record.path}: legacy proof`);
        if (metadata.format !== 'niceeval.memory/v1' || metadata.id !== path.basename(record.path, '.md') ||
          metadata.title !== record.title || metadata.createdAt !== record.createdAt.value ||
          kind.type !== record.migratedKind || kind.state !== record.migratedStateFact ||
          JSON.stringify(promotions.flatMap(p => p.current)) !== JSON.stringify(record.promotionCurrent) ||
          JSON.stringify(promotions.flatMap(p => p.history)) !== JSON.stringify(record.promotionHistory) ||
          JSON.stringify(proof) !== JSON.stringify(record.resolutionProofOriginal)) {
          return yield* Effect.fail(new MigrationError(`${record.path}: incremental migration must preserve declared legacy facts`));
        }
      }
      const source: SourceRef = { path: record.path, commit: head, digest: sourceDigest };
      const indexRef: SourceRef = { path: 'memory/INDEX.md', commit: head, digest: digest(index) };
      const target = targetMetadata(record, metadata, parts.raw, parts.body.toString('utf8'), index, at, source, indexRef, knownKinds);
      const rendered = `---\n${stringifyYaml(target).replace(/\n$/, '')}\n---\n${parts.body.toString('utf8')}`;
      const renderedDocument = parseDocument(rendered.slice(4, rendered.indexOf('\n---\n', 4)), { uniqueKeys: true, merge: false });
      if (renderedDocument.errors.length > 0) throw new MigrationError(`rendered frontmatter is invalid for ${record.path}`);
      decode(MemorySchema, renderedDocument.toJS({ maxAliasCount: 0 }), `rendered migration ${record.path}`);
      const targetPath = `memory/${target.id}.md`;
      changes.push({ path: targetPath, before: full.toString('utf8'), after: rendered });
      audit.push({ sourcePath: record.path, targetPath, sourceDigest, bodyDigest, sourceMetadata: parts.metadata ?? { raw: parts.raw, diagnostic: record.diagnostic } });
    }
    return { changes, audit } satisfies MemoryMigrationPart;
  });
}
