import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import { parseDocument, stringify } from 'yaml';
import {
  ConcordError, GitCommit, IssueClosureSchema, IssueOriginSchema, IssueSchema, ResearchSchema,
  Sha256, Slug, Text, decode, digest, type Change, type IssueMeta,
} from '../src/shared.js';

export interface MigrationAudit {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly sourceDigest: string;
  readonly bodyDigest: string;
  readonly sourceMetadata: unknown;
}
export interface MigrationPart { readonly changes: readonly Change[]; readonly audit: readonly MigrationAudit[] }

const ResearchEntry = Schema.Struct({
  path: Text, role: Schema.Literals(['owner', 'index', 'receipt', 'supporting']), id: Schema.NullOr(Slug), title: Text,
  classificationEvidence: Schema.Array(Text), supportingOwner: Schema.NullOr(Text),
  observedAt: Schema.NullOr(Text), observedAtEvidence: Schema.Unknown,
  createdAt: Text, createdAtSource: Text, firstRecordedCommit: GitCommit,
  bodyDigest: Sha256, bodyByteLength: Schema.Int, bodyLineCount: Schema.Int,
  sources: Schema.Array(Schema.Struct({ url: Text, evidence: Text })), supports: Schema.Unknown, supportLinks: Schema.Unknown, diagnostics: Schema.Unknown,
});
const ResearchManifest = Schema.Struct({
  format: Schema.Literal('niceeval.research-migration-manifest/v1'), generatedAt: Text,
  source: Schema.Unknown, policy: Schema.Unknown, entries: Schema.Array(ResearchEntry), validation: Schema.Unknown,
});
const FeedbackEntry = Schema.Struct({
  sourcePath: Text, targetPath: Text, originalId: Text, targetId: Slug, operation: Schema.Literal('move'),
  sourceReadmeDigest: Sha256, bodyDigest: Sha256, sourceMetadata: Schema.Unknown, targetMetadata: Schema.Unknown, references: Schema.Unknown,
});
const FeedbackManifest = Schema.Struct({
  format: Schema.Literal('niceeval.feedback-migration-manifest/v1'), status: Schema.Literal('prepared'), generatedAt: Text,
  repository: Text, sourceRoot: Text, ownerTransfer: Schema.Unknown, mappingRules: Schema.Unknown,
  entries: Schema.Array(FeedbackEntry), receipts: Schema.Unknown, dependencyAudit: Schema.Unknown, validation: Schema.Unknown, referenceScan: Schema.Unknown,
});
// These input schemas belong exclusively to this one-time offline migration.
const FeedbackInput = Schema.Struct({
  format: Schema.Literal('niceeval.feedback/v2'), id: Text, title: Text, state: Schema.Literals(['open', 'closed']),
  reportedAt: Text, source: IssueOriginSchema, subject: Schema.Literals(['product', 'repository', 'dependency']),
  claim: Schema.Literals(['defect', 'friction', 'request']), observation: Text, impact: Text,
  memoryRelations: Schema.Array(Schema.Struct({ kind: Schema.Literals(['investigation', 'root-cause', 'decision', 'delivery']), memory: Text })),
  adoptions: Schema.Struct({ current: Schema.Array(Text), history: Schema.Array(Schema.Struct({ target: Text, commit: GitCommit })) }),
  closure: Schema.optional(IssueClosureSchema),
});

export function splitFrontmatter(source: string, path: string): { metadata: unknown; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(source);
  if (match === null) throw new ConcordError('MigrationSourceInvalid', `${path}: expected complete frontmatter`);
  const parsed = parseDocument(match[1]!, { uniqueKeys: true, merge: false });
  if (parsed.errors.length > 0) throw new ConcordError('MigrationSourceInvalid', `${path}: ${parsed.errors.map(error => error.message).join('; ')}`);
  return { metadata: parsed.toJS({ maxAliasCount: 0 }) as unknown, body: match[2]! };
}

export const prepareResearchFeedbackMigration = Effect.fn('prepareResearchFeedbackMigration')(function*(
  root: string, researchManifestPath: string, feedbackManifestPath: string, head: string, at: string,
): Effect.fn.Return<MigrationPart, Error> {
  return yield* Effect.try({
    try: () => {
      const research = decode(ResearchManifest, JSON.parse(readFileSync(researchManifestPath, 'utf8')) as unknown, researchManifestPath);
      const feedback = decode(FeedbackManifest, JSON.parse(readFileSync(feedbackManifestPath, 'utf8')) as unknown, feedbackManifestPath);
      const changes: Change[] = [];
      const audit: MigrationAudit[] = [];
      const ids = new Map(feedback.entries.map(entry => [entry.originalId, entry.targetPath]));
      const memoryRef = (id: string): string => id.startsWith('memory/') ? id : `memory/${id}.md`;
      for (const entry of research.entries) {
        const source = readFileSync(join(root, entry.path), 'utf8');
        if (digest(source) !== entry.bodyDigest) throw new ConcordError('MigrationSourceChanged', entry.path);
        audit.push({ sourcePath: entry.path, targetPath: entry.path, sourceDigest: digest(source), bodyDigest: digest(source), sourceMetadata: null });
        if (entry.role !== 'owner') continue;
        if (entry.id === null || entry.classificationEvidence.length === 0) throw new ConcordError('MigrationClassificationMissing', entry.path);
        const metadata = decode(ResearchSchema, {
          format: 'concord.document/v1', kind: 'research', id: entry.id, title: entry.title,
          createdAt: entry.createdAt,
          ...(entry.createdAtSource === 'git-first-recorded' ? { createdAtSource: { kind: 'first-recorded', path: entry.path, commit: entry.firstRecordedCommit } } : {}),
          ...(entry.observedAt === null ? {} : { observedAt: entry.observedAt }), sources: entry.sources.map(source => source.url),
        }, entry.path);
        changes.push({ path: entry.path, before: source, after: `---\n${stringify(metadata, { lineWidth: 0 }).trimEnd()}\n---\n${source}` });
      }
      for (const entry of feedback.entries) {
        const source = readFileSync(join(root, entry.sourcePath), 'utf8');
        if (digest(source) !== entry.sourceReadmeDigest) throw new ConcordError('MigrationSourceChanged', entry.sourcePath);
        const parsed = splitFrontmatter(source, entry.sourcePath);
        if (digest(parsed.body) !== entry.bodyDigest) throw new ConcordError('MigrationBodyChanged', entry.sourcePath);
        const old = decode(FeedbackInput, parsed.metadata, entry.sourcePath);
        if (old.id !== entry.originalId || entry.targetPath !== `docs/issues/${entry.targetId}.md`) throw new ConcordError('MigrationIdentityMismatch', entry.sourcePath);
        let closure: IssueMeta['closure'] = old.closure;
        if (closure !== undefined && 'memory' in closure) closure = { ...closure, memory: memoryRef(closure.memory) };
        if (closure?.kind === 'duplicate') {
          const target = ids.get(closure.canonical);
          if (target === undefined) throw new ConcordError('MigrationReferenceMissing', `${entry.sourcePath}: duplicate ${closure.canonical}`);
          closure = { ...closure, canonical: target };
        }
        const metadata = decode(IssueSchema, {
          format: 'concord.document/v1', kind: 'issue', id: entry.targetId, title: old.title,
          createdAt: old.reportedAt, state: old.state === 'open' ? 'draft' : 'closed', origin: old.source,
          subject: old.subject, claim: old.claim, observation: old.observation, impact: old.impact,
          memoryRelations: old.memoryRelations.map(relation => ({ ...relation, memory: memoryRef(relation.memory) })),
          adoptions: old.adoptions, ...(closure === undefined ? {} : { closure }),
          history: [{ at, action: 'migrate', reason: 'Transferred the existing observation to its current Issue owner.', source: { path: entry.sourcePath, commit: head, digest: digest(source) } }],
        }, entry.targetPath);
        changes.push({ path: entry.sourcePath, before: source, after: null });
        changes.push({ path: entry.targetPath, before: null, after: `---\n${stringify(metadata, { lineWidth: 0 }).trimEnd()}\n---\n${parsed.body}` });
        audit.push({ sourcePath: entry.sourcePath, targetPath: entry.targetPath, sourceDigest: digest(source), bodyDigest: digest(parsed.body), sourceMetadata: parsed.metadata });
      }
      return { changes, audit };
    },
    catch: cause => cause instanceof Error ? cause : new Error(String(cause)),
  });
});
