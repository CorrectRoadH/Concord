import { existsSync, readFileSync, readdirSync, statSync, lstatSync } from "node:fs";
import { createHash } from 'node:crypto';
import { join, relative, resolve, sep } from "node:path";
import { Effect, Result, Schema } from "effect";
import { IssueSchema, type IssueClosure, type IssueMemoryRelation, type IssueMeta } from "concord-sdlc/model";
import { parseRepoRef, validateRepoRefTarget, type RepoRef, type ValidatedRepoRefTarget } from "../docs/trace/ref.js";
import { ADOPTABLE_DOCS_NODE_KINDS, type TraceSnapshot } from "../docs/trace/model.js";
import { decodeMemoryDocument } from "../memory/codec.js";
import { decodeFeedbackDocument, encodeFeedbackDocument, type FeedbackDocument } from "./codec.js";
import { FeedbackContentInvalid, FeedbackFileMissing, FeedbackIoError, FeedbackReferenceConflict, type FeedbackError } from "./errors.js";
import { adoptFeedback, closeFeedback, linkMemory, reopenFeedback, retireFeedback } from "./state.js";
import { FeedbackEnvelopeV1Schema } from './schema.js';
import { traceDigest, type TraceMultiFileChange } from '../docs/trace/relation-mutation.js';

export interface FeedbackRepositoryOptions { readonly root?: string }
export interface FeedbackCheckReceipt { readonly ok: boolean; readonly checked: number; readonly findings: readonly string[] }
const message = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

export class FeedbackRepository {
  readonly #root: string;
  constructor(options: FeedbackRepositoryOptions = {}) { this.#root = resolve(options.root ?? process.cwd()); }
  get root(): string { return this.#root; }
  safePath(path: string): string {
    const parsed = parseRepoRef(path);
    if (Result.isFailure(parsed) || parsed.success.path !== path) throw new FeedbackReferenceConflict({ operation: 'path', path, message: 'expected canonical path without anchor' });
    let cursor: string = sep;
    for (const part of join(this.#root, path).slice(1).split(sep)) {
      cursor = join(cursor, part);
      try { if (lstatSync(cursor).isSymbolicLink()) throw new FeedbackReferenceConflict({ operation: 'path', path, message: 'symbolic links are forbidden' }); }
      catch (cause) { if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') break; throw cause; }
    }
    return join(this.#root, path);
  }
  ownerPath(id: string): string { this.#guardId(id); return "docs/issues/" + id + ".md"; }
  absoluteOwnerPath(id: string): string { return this.safePath(this.ownerPath(id)); }
  #guardId(id: string): void { if (!/^[a-z0-9][a-z0-9-]*$/u.test(id)) throw new FeedbackContentInvalid({ operation: "resolve id", message: "unsafe Issue id" }); }
  list(): readonly FeedbackDocument[] {
    const dir = this.safePath('docs/issues'); if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true }).filter((entry) => {
      if (entry.isSymbolicLink()) throw new FeedbackReferenceConflict({ operation: 'list', path: entry.name, message: 'symbolic links are forbidden' });
      return entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md';
    }).map((entry) => this.read(entry.name.slice(0, -3))).sort((a, b) => a.metadata.id.localeCompare(b.metadata.id));
  }
  read(id: string): FeedbackDocument {
    const path = this.absoluteOwnerPath(id); if (!existsSync(path)) throw new FeedbackFileMissing({ operation: "read", path: this.ownerPath(id), message: "not found" });
    try { return decodeFeedbackDocument(this.ownerPath(id), readFileSync(path, "utf8")); } catch (cause) { if (cause instanceof FeedbackContentInvalid) throw cause; throw new FeedbackIoError({ operation: "read", path: this.ownerPath(id), message: message(cause) }); }
  }
  planCreate(document: FeedbackDocument) {
    const issue = document.metadata; this.#guardId(issue.id);
    if (issue.kind !== "issue" || issue.state !== "draft" || issue.closure !== undefined || issue.adoptions.current.length > 0 || issue.adoptions.history.length > 0) throw new FeedbackReferenceConflict({ operation: "add", message: "new Issue must be draft, open, and have no closure or adoption history" });
    if (issue.history.length > 0) throw new FeedbackReferenceConflict({ operation: 'add', message: 'new Issue cannot inject lifecycle history' });
    this.validateIssue(issue);
    if (existsSync(this.absoluteOwnerPath(issue.id))) throw new FeedbackReferenceConflict({ operation: "add", path: this.ownerPath(issue.id), message: "Issue already exists" });
    return { bytes: encodeFeedbackDocument(document), metadata: issue };
  }
  planTransition(id: string, source: string | undefined, transition: (value: IssueMeta) => Result.Result<IssueMeta, FeedbackReferenceConflict>) {
    if (source === undefined) throw new FeedbackFileMissing({ operation: "mutate", path: this.ownerPath(id), message: "not found" });
    const document = decodeFeedbackDocument(this.ownerPath(id), source); const result = transition(document.metadata);
    if (Result.isFailure(result)) throw result.failure;
    return { bytes: encodeFeedbackDocument({ ...document, metadata: result.success }), metadata: result.success };
  }
  planLink(id: string, source: string | undefined, relation: IssueMemoryRelation) { this.#readMemory(relation.memory); return this.planTransition(id, source, (issue) => linkMemory(issue, relation)); }
  planAdopt(id: string, source: string | undefined, target: RepoRef) { return this.planTransition(id, source, (issue) => adoptFeedback(issue, target)); }
  planRetire(id: string, source: string | undefined, target: RepoRef, commit: string) { return this.planTransition(id, source, (issue) => retireFeedback(issue, target, commit)); }
  planClose(id: string, source: string | undefined, closure: IssueClosure, at: string, reason: string) {
    const planned = this.planTransition(id, source, (issue) => closeFeedback(issue, closure, at, reason));
    this.validateIssue(planned.metadata);
    return planned;
  }
  planReopen(id: string, source: string | undefined, at: string, reason: string) { return this.planTransition(id, source, (issue) => reopenFeedback(issue, at, reason)); }
  targetSource(target: unknown) {
    const parsed = parseRepoRef(target); if (Result.isFailure(parsed)) throw new FeedbackReferenceConflict({ operation: "target", message: parsed.failure.message });
    const absolutePath = this.safePath(parsed.success.path);
    if (!absolutePath.startsWith(this.#root + sep) || !existsSync(absolutePath) || !statSync(absolutePath).isFile()) throw new FeedbackReferenceConflict({ operation: "target", path: parsed.success.path, message: "target missing or unsafe" });
    return { path: parsed.success.path, absolutePath, source: readFileSync(absolutePath, "utf8") };
  }
  validateTarget(snapshot: TraceSnapshot, target: unknown): ValidatedRepoRefTarget {
    const source = this.targetSource(target); const result = validateRepoRefTarget(snapshot, target, ADOPTABLE_DOCS_NODE_KINDS, source.source);
    if (Result.isFailure(result)) throw new FeedbackReferenceConflict({ operation: "target", path: source.path, message: result.failure.message });
    return result.success;
  }
  check(snapshot: TraceSnapshot): FeedbackCheckReceipt {
    const findings: string[] = []; const issues = this.list();
    for (const item of issues) {
      try { this.validateIssue(item.metadata, snapshot); } catch (cause) { findings.push(item.metadata.id + ': ' + message(cause)); }
    }
    return { ok: findings.length === 0, checked: issues.length, findings };
  }
  #readMemory(ref: string) {
    const match = /^memory\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/.exec(ref);
    if (!match?.[1]) throw new FeedbackReferenceConflict({ operation: 'memory', path: ref, message: 'expected canonical Memory path' });
    try { return decodeMemoryDocument(ref, match[1], readFileSync(this.safePath(ref), 'utf8')).metadata; }
    catch (cause) { throw new FeedbackReferenceConflict({ operation: 'memory', path: ref, message: message(cause) }); }
  }
  validateIssue(issue: IssueMeta, snapshot?: TraceSnapshot): void {
    const fail = (message: string): never => { throw new FeedbackReferenceConflict({ operation: 'validate', path: this.ownerPath(issue.id), message }); };
    if ((issue.state === 'closed') !== (issue.closure !== undefined)) fail('state and closure disagree');
    const keys = issue.memoryRelations.map(relation => `${relation.kind}\0${relation.memory}`);
    if (new Set(keys).size !== keys.length) fail('duplicate Memory relations');
    for (const relation of issue.memoryRelations) this.#readMemory(relation.memory);
    if (new Set(issue.adoptions.current).size !== issue.adoptions.current.length) fail('duplicate current adoptions');
    for (const target of issue.adoptions.current) {
      this.targetSource(target);
      if (snapshot !== undefined) this.validateTarget(snapshot, target);
    }
    const closure = issue.closure;
    if (closure === undefined) return;
    if (['declined', 'invalid', 'duplicate'].includes(closure.kind) && issue.adoptions.current.length > 0) fail('retire current adoptions before closure');
    if ('memory' in closure) {
      const memory = this.#readMemory(closure.memory);
      if (closure.kind === 'fixed' && !(memory.memoryKind === 'problem' && memory.state === 'resolved' && memory.resolution?.kind === 'fixed')) fail('fixed closure requires a resolved fixed Problem');
      if (closure.kind === 'declined' && !(memory.memoryKind === 'decision' && memory.state === 'current')) fail('declined closure requires a current Decision');
      if (closure.kind === 'delivered') {
        if (!(memory.memoryKind === 'problem' && memory.state === 'resolved' || memory.memoryKind === 'decision' && memory.state === 'current')) fail('delivered closure requires a resolved Problem or current Decision');
        if (!issue.adoptions.current.includes(closure.target) && !issue.adoptions.history.some(entry => entry.target === closure.target)) fail('delivered target is not adopted');
        this.targetSource(closure.target);
      }
    }
    if (closure.kind === 'duplicate') {
      const seen = new Set([this.ownerPath(issue.id)]);
      let cursor: string | undefined = closure.canonical;
      while (cursor !== undefined) {
        if (seen.has(cursor)) fail('duplicate Issue cycle');
        seen.add(cursor);
        const match = /^docs\/issues\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/.exec(cursor);
        if (!match?.[1]) fail('duplicate target must be a canonical Issue path');
        const target = this.read(match![1]!);
        cursor = target.metadata.closure?.kind === 'duplicate' ? target.metadata.closure.canonical : undefined;
      }
    }
  }
  prepareImport(input: unknown, artifactRoot: string, at: string): { document: FeedbackDocument; files: readonly TraceMultiFileChange[] } {
    const envelope = Schema.decodeUnknownSync(FeedbackEnvelopeV1Schema, { onExcessProperty: 'error' })(input);
    const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, canonical(value)])) : value;
    const { digest: declaredDigest, ...unsigned } = envelope;
    const signature = createHash('sha256').update(JSON.stringify(canonical(unsigned))).digest('hex');
    if (declaredDigest !== signature) throw new FeedbackContentInvalid({ operation: 'import', message: 'envelope digest mismatch' });
    const id = 'feedback-' + createHash('sha256').update(`${envelope.origin.repository}\0${envelope.origin.originId}`).digest('hex').slice(0, 16);
    const declared = new Set(envelope.artifacts.map(file => file.path));
    if (declared.size !== envelope.artifacts.length || envelope.artifacts.reduce((sum, file) => sum + file.byteLength, 0) > 100 * 1024 * 1024) throw new FeedbackContentInvalid({ operation: 'import', message: 'duplicate paths or excessive artifact bundle' });
    const artifactRepository = new FeedbackRepository({ root: artifactRoot });
    // Validate the complete source set, including undeclared files and symlinks.
    artifactRepository.safePath('artifact-validation');
    if (existsSync(artifactRoot)) for (const entry of readdirSync(artifactRoot, { recursive: true, withFileTypes: true })) {
      const path = relative(artifactRoot, join(entry.parentPath, entry.name)).split(sep).join('/');
      if (entry.isSymbolicLink() || !entry.isDirectory() && !entry.isFile() || entry.isFile() && !declared.has(path)) throw new FeedbackContentInvalid({ operation: 'import', path, message: 'undeclared or unsafe artifact' });
    }
    const files = envelope.artifacts.map(file => {
      if (file.byteLength > 20 * 1024 * 1024) throw new FeedbackContentInvalid({ operation: 'import', path: file.path, message: 'artifact exceeds size limit' });
      const bytes = readFileSync(artifactRepository.safePath(file.path));
      if (bytes.byteLength !== file.byteLength || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new FeedbackContentInvalid({ operation: 'import', path: file.path, message: 'artifact size or digest mismatch' });
      return { path: `docs/issues/${id}/artifacts/${file.path}`, bytes, expectedDigest: null };
    });
    const previous = this.list().find(item => item.metadata.origin?.kind === 'dogfood' && item.metadata.origin.repository === envelope.origin.repository && item.metadata.origin.originId === envelope.origin.originId);
    if (previous !== undefined) {
      if (!previous.body.includes(`Envelope digest: \`${envelope.digest}\``)) throw new FeedbackReferenceConflict({ operation: 'import', message: 'origin already exists with a different envelope' });
      for (const file of files) if (traceDigest(readFileSync(this.safePath(file.path))) !== traceDigest(file.bytes)) throw new FeedbackReferenceConflict({ operation: 'import', path: file.path, message: 'previous artifact changed' });
      return { document: previous, files: [] };
    }
    const metadata: IssueMeta = { format: 'concord.document/v1', kind: 'issue', id, title: envelope.observation.split('\n')[0] || id, createdAt: at, state: 'draft', memoryRelations: [], adoptions: { current: [], history: [] }, observation: envelope.observation, impact: envelope.impact, origin: { kind: 'dogfood', ...envelope.origin }, subject: 'product', claim: 'friction', history: [] };
    const body = `# ${metadata.title}\n\nEnvelope digest: \`${envelope.digest}\`\n\n\`\`\`json\n${JSON.stringify(envelope, null, 2)}\n\`\`\`\n`;
    const document = { metadata, body };
    return { document, files: [{ path: this.ownerPath(id), bytes: this.planCreate(document).bytes, expectedDigest: null }, ...files] };
  }
}
export const feedbackEffect = <A>(operation: string, thunk: () => A): Effect.Effect<A, FeedbackError> => Effect.try({ try: thunk, catch: (cause) => cause instanceof FeedbackFileMissing || cause instanceof FeedbackContentInvalid || cause instanceof FeedbackReferenceConflict || cause instanceof FeedbackIoError ? cause : new FeedbackIoError({ operation, message: message(cause) }) });
