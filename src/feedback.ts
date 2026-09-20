// @concord-file
// @concord-implements docs/feature/feedback/use-case/triage-feedback.md
import { Effect } from 'effect';
import { readFeedbackCache, mergeFeedbackCache } from './feedback-cache.js';
import {
  FeedbackConnectionSchema,
  FeedbackSourceSchema,
  RemoteFeedbackSchema,
  feedbackIdentity,
  type FeedbackConnection,
  type FeedbackItem,
  type FeedbackSource,
  type RemoteFeedback,
} from './feedback-schema.js';
import { loadDocuments, renderDocument } from './documents.js';
import { fetchFeedback, type FeedbackTransport } from './feedback-providers.js';
import { ConcordError, ProjectSchema, canonical, decode, digest, failure, type DocumentMeta, type DocumentRecord, type MutationReceipt } from './shared.js';
import { LocalRepository } from './storage.js';
import { renderTypeScriptConfig } from './config.js';

export interface FeedbackSyncOptions {
  readonly url?: string;
  readonly dryRun?: boolean;
  readonly transport?: FeedbackTransport;
  /** Test-only credential injection; production callers leave this unset. */
  readonly credential?: string;
}

export interface FeedbackSyncReceipt extends MutationReceipt {
  readonly connection: FeedbackConnection;
  readonly fetched: number;
  readonly imported: number;
  readonly warnings: readonly string[];
}

const attempt = <A>(name: string, evaluate: () => A): Effect.Effect<A, ConcordError> => Effect.try({
  try: evaluate,
  catch: failure,
}).pipe(Effect.withSpan(name));

function withRepository<A>(
  root: string,
  use: (repo: LocalRepository) => Effect.Effect<A, ConcordError>,
  dryRun: boolean,
): Effect.Effect<A, ConcordError> {
  return Effect.acquireRelease(
    attempt('feedback.openRepository', () => new LocalRepository(root, { dryRun })),
    (repo) => Effect.sync(() => repo.close()),
  ).pipe(Effect.flatMap(use), Effect.scoped);
}

function configSnapshot(repo: LocalRepository, connectionId: string): { readonly source: string; readonly digest: string; readonly connection: FeedbackConnection } {
  const source = repo.read(repo.configSnapshot.path);
  if (source === undefined) throw new ConcordError('ProjectNotFound', `${repo.configSnapshot.path} disappeared before feedback synchronization`);
  const matches = (repo.config.feedbackConnections ?? []).filter((connection) => connection.id === connectionId);
  if (matches.length !== 1) throw new ConcordError(matches.length === 0 ? 'FeedbackConnectionNotFound' : 'InvalidData', `Expected one feedback connection with ID ${connectionId}, found ${matches.length}`);
  return { source, digest: repo.configSnapshot.digest, connection: matches[0]! };
}

function assertReturnedConnection(expected: FeedbackConnection, input: unknown): FeedbackConnection {
  const actual = decode(FeedbackConnectionSchema, input, 'fetched feedback connection');
  const fixed = expected.provider === 'github'
    ? actual.provider === 'github' && actual.id === expected.id && actual.credentialEnv === expected.credentialEnv && actual.owner === expected.owner && actual.repo === expected.repo
    : actual.provider === 'linear' && actual.id === expected.id && actual.credentialEnv === expected.credentialEnv && actual.team === expected.team;
  if (!fixed) throw new ConcordError('FeedbackConnectionMismatch', 'Provider changed immutable connection fields');
  if (expected.provider === 'github' && actual.provider === 'github') {
    if (actual.repositoryId === undefined) throw new ConcordError('FeedbackConnectionUnbound', 'GitHub fetch did not resolve a repository ID');
    if (expected.repositoryId !== undefined && actual.repositoryId !== expected.repositoryId) throw new ConcordError('FeedbackConnectionMismatch', 'GitHub repository identity differs from the bound connection');
  }
  if (expected.provider === 'linear' && actual.provider === 'linear') {
    if (actual.organizationId === undefined || actual.teamId === undefined) throw new ConcordError('FeedbackConnectionUnbound', 'Linear fetch did not resolve organization and team IDs');
    if (expected.organizationId !== undefined && actual.organizationId !== expected.organizationId) throw new ConcordError('FeedbackConnectionMismatch', 'Linear organization identity differs from the bound connection');
    if (expected.teamId !== undefined && actual.teamId !== expected.teamId) throw new ConcordError('FeedbackConnectionMismatch', 'Linear team identity differs from the bound connection');
  }
  return actual;
}

function distinctRemote(input: readonly RemoteFeedback[]): { readonly items: readonly RemoteFeedback[]; readonly warnings: readonly string[] } {
  const items = new Map<string, RemoteFeedback>();
  const warnings: string[] = [];
  for (const candidate of input) {
    const remote = decode(RemoteFeedbackSchema, candidate, 'fetched feedback item');
    const identity = feedbackIdentity(remote);
    const prior = items.get(identity);
    const comparison = prior === undefined ? 1 : Date.parse(remote.updatedAt) - Date.parse(prior.updatedAt);
    if (prior === undefined || comparison > 0) items.set(identity, remote);
    else if (comparison === 0 && comparableRemote(remote) !== comparableRemote(prior)) {
      warnings.push(`Remote identity ${identity} had conflicting payloads at ${remote.updatedAt}; preserved the first payload.`);
    }
  }
  return { items: [...items.values()].sort((left, right) => feedbackIdentity(left).localeCompare(feedbackIdentity(right))), warnings };
}

function comparableRemote(remote: RemoteFeedback): string {
  return canonical({ ...remote, updatedAt: new Date(Date.parse(remote.updatedAt)).toISOString() });
}

function importedId(remote: RemoteFeedback): string {
  return `feedback-${remote.provider}-${remote.id}`;
}

function issueRecord(record: DocumentRecord): FeedbackItem['document'] {
  if (record.metadata.kind !== 'issue') throw new ConcordError('InvalidDocumentKind', `${record.path} is not feedback`);
  return record as FeedbackItem['document'];
}

export function listFeedback(repo: LocalRepository, inspectedDocuments?: readonly DocumentRecord[]): readonly FeedbackItem[] {
  const documents = (inspectedDocuments ?? loadDocuments(repo)).filter((document): document is DocumentRecord & { readonly metadata: Extract<DocumentMeta, { kind: 'issue' }> } => document.metadata.kind === 'issue');
  let cached: ReturnType<typeof readFeedbackCache> = { items: new Map(), warnings: [] };
  let cacheWarning: string | undefined;
  try { cached = readFeedbackCache(repo); }
  catch (cause) { cacheWarning = `Feedback cache unavailable: ${cause instanceof Error ? cause.message : String(cause)}`; }
  const identities = new Map<string, string>();
  return documents.map((document) => {
    const source = document.metadata.source;
    const warnings = [...cached.warnings];
    let remote: RemoteFeedback | null = null;
    let availability: FeedbackItem['availability'] = 'local';
    if (source !== undefined) {
      const identity = feedbackIdentity(source);
      const prior = identities.get(identity);
      if (prior !== undefined) warnings.push(`Remote identity is also imported by ${prior}; preserved both local documents for manual repair.`);
      else identities.set(identity, document.path);
      remote = cached.items.get(identity)?.remote ?? null;
      availability = remote === null ? 'unavailable' : 'cached';
      if (cacheWarning !== undefined) warnings.push(cacheWarning);
    }
    const features = document.metadata.adoptions.current;
    const triage: FeedbackItem['triage'] = document.metadata.state === 'closed'
      ? 'closed'
      : features.length > 0 || document.metadata.memoryRelations.length > 0 ? 'linked' : 'pending';
    return { document: issueRecord(document), triage, remote, availability, warnings };
  });
}

export const syncFeedback = Effect.fn('feedback.sync')(function*(
  root: string,
  connectionId: string,
  options: FeedbackSyncOptions = {},
): Effect.fn.Return<FeedbackSyncReceipt, ConcordError> {
  const observed = yield* withRepository(root, (repo) => attempt('feedback.snapshot', () => configSnapshot(repo, connectionId)), true);
  const fetched = yield* fetchFeedback(observed.connection, {
    ...(options.url === undefined ? {} : { url: options.url }),
    ...(options.transport === undefined ? {} : { transport: options.transport }),
    ...(options.credential === undefined ? {} : { credential: options.credential }),
  });
  const bound = yield* attempt('feedback.validateFetch', () => assertReturnedConnection(observed.connection, fetched.connection));
  const remote = yield* attempt('feedback.validateItems', () => distinctRemote(fetched.items));
  yield* attempt('feedback.validateScope', () => {
    for (const item of remote.items) {
      if (item.provider !== bound.provider) throw new ConcordError('FeedbackScopeMismatch', 'Provider returned an item for a different provider');
      if (bound.provider === 'linear' && item.provider === 'linear' && item.organizationId !== bound.organizationId) throw new ConcordError('FeedbackScopeMismatch', 'Linear item belongs to a different organization');
    }
  });
  const dryRun = options.dryRun ?? false;

  return yield* withRepository(root, (repo) => attempt('feedback.publish', () => {
    const current = configSnapshot(repo, connectionId);
    if (current.digest !== observed.digest) throw new ConcordError('PreimageChanged', `${repo.configSnapshot.path} changed while remote feedback was fetched; retry with the current configuration`);
    assertReturnedConnection(current.connection, bound);
    const documents = loadDocuments(repo);
    const existingSources = new Map<string, string>();
    const ids = new Map(documents.filter((document) => document.metadata.kind === 'issue').map((document) => [document.metadata.id, document.path]));
    for (const document of documents) if (document.metadata.kind === 'issue' && document.metadata.source !== undefined) {
      const identity = feedbackIdentity(document.metadata.source);
      const prior = existingSources.get(identity);
      if (prior !== undefined) throw new ConcordError('FeedbackIdentityConflict', `Remote identity ${identity} is imported by both ${prior} and ${document.path}`);
      existingSources.set(identity, document.path);
    }
    const importedAt = fetched.fetchedAt;
    const changes: { path: string; before: string | null; after: string | null }[] = [];
    const nextConnections = (repo.config.feedbackConnections ?? []).map((connection) => connection.id === connectionId ? bound : connection);
    if (canonical(nextConnections) !== canonical(repo.config.feedbackConnections ?? [])) {
      const nextConfig = decode(ProjectSchema, { ...repo.config, feedbackConnections: nextConnections }, 'bound feedback configuration');
      changes.push({ path: repo.configSnapshot.path, before: current.source, after: repo.configSnapshot.path === 'concord.config.ts' ? renderTypeScriptConfig(nextConfig) : `${JSON.stringify(nextConfig, null, 2)}\n` });
    }
    for (const item of remote.items) {
      const identity = feedbackIdentity(item);
      if (existingSources.has(identity)) continue;
      let id = importedId(item);
      if (ids.has(id)) id = `${id}-${digest(identity).slice('sha256:'.length, 'sha256:'.length + 12)}`;
      if (ids.has(id)) throw new ConcordError('FeedbackIdentityConflict', `Cannot allocate a unique local issue ID for ${identity}`);
      const path = `docs/issues/${id}.md`;
      const source: FeedbackSource = decode(FeedbackSourceSchema, { ...item, connectionId, importedAt }, `feedback source ${identity}`);
      const metadata: DocumentMeta = {
        format: 'concord.document/v1', id, title: item.title, createdAt: importedAt, kind: 'issue', state: 'draft', memoryRelations: [], adoptions: { current: [], history: [] }, source, history: [],
      };
      const body = item.body.trim().length > 0 ? item.body : `Imported feedback: ${item.url}`;
      changes.push({ path, before: null, after: renderDocument(metadata, body) });
      ids.set(id, path);
      existingSources.set(identity, path);
    }
    const receipt = changes.length === 0
      ? { operation: options.url === undefined ? 'feedback-sync' : 'feedback-import', dryRun, changedPaths: [] }
      : repo.publish(options.url === undefined ? 'feedback-sync' : 'feedback-import', changes, dryRun);
    const warnings = [...remote.warnings];
    if (!dryRun) {
      try { warnings.push(...mergeFeedbackCache(repo, connectionId, remote.items)); }
      catch (cause) { warnings.push(`Documents were committed but the private feedback cache could not be updated: ${cause instanceof Error ? cause.message : String(cause)}`); }
    }
    return { ...receipt, connection: bound, fetched: fetched.items.length, imported: changes.filter((change) => change.path.startsWith('docs/issues/')).length, warnings };
  }), dryRun);
});
