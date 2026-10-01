import { readFileSync } from "node:fs";
import { Effect } from "effect";
import { IssueProject, type IssueCommandRunner } from "./contribution.js";
import { IssuePlanStore, IssueRemote } from "./domain.js";
import { makeNodeIssuePlanStore } from "./plan-store.js";
import { makeGhIssueRemote, type IssueGhRequest } from "./gh.js";
import { IssueConnectionUnbound, IssueInputError, IssueRemoteTransportUnsupported, type IssueGhError } from "./errors.js";
interface Connection { readonly id: string; readonly provider: string; readonly transport?: string; readonly repositoryId?: string; readonly owner?: string; readonly repo?: string }
interface Repository { readonly root: string; readonly config: { readonly feedbackConnections?: readonly Connection[] }; readonly close: () => void }
interface StorageModule { readonly LocalRepository: new(root?: string, options?: { readonly access: "read"; readonly optimistic: boolean }) => Repository }
interface GhModule { readonly withGhIssueTransport: <A, E>(root: string, connection: Connection, execute: boolean, use: (request: IssueGhRequest) => Effect.Effect<A, E>) => Effect.Effect<A, E | IssueGhError> }
export const makeNodeIssueCommandRunner = (root: string | undefined): IssueCommandRunner => (connectionId, execute, program) => Effect.gen(function*() {
  const storagePath = new URL(import.meta.url).pathname.endsWith(".ts") ? "../../src/storage.ts" : "../../storage.js";
  const ghPath = new URL(import.meta.url).pathname.endsWith(".ts") ? "../../src/feedback-gh.ts" : "../../feedback-gh.js";
  const storage = yield* Effect.tryPromise({ try: () => import(storagePath) as Promise<StorageModule>, catch: () => new IssueInputError({ message: "Project configuration reader unavailable" }) });
  const snapshot = yield* Effect.try({ try: () => {
    const repo = new storage.LocalRepository(root, { access: "read", optimistic: true });
    try { return { root: repo.root, connections: repo.config.feedbackConnections ?? [] }; } finally { repo.close(); }
  }, catch: cause => cause as IssueGhError });
  const connection = snapshot.connections.find(item => item.id === connectionId);
  if (connection === undefined) return yield* Effect.fail(new IssueInputError({ message: "Unknown feedback connection" }));
  if (connection.provider !== "github" || connection.transport !== "gh") return yield* Effect.fail(new IssueRemoteTransportUnsupported({ message: "Remote Issue writes require a GitHub CLI connection" }));
  if (!connection.repositoryId) return yield* Effect.fail(new IssueConnectionUnbound({ message: "Connection must bind repositoryId before remote Issue writes" }));
  const owner = connection.owner!;
  const repo = connection.repo!;
  const binding = { connection: connectionId, repositoryId: connection.repositoryId, repository: { host: "github.com" as const, repository: `${owner}/${repo}` } };
  const project = IssueProject.of({ connection: id => id === connectionId ? Effect.succeed(binding) : Effect.fail(new IssueInputError({ message: "Connection differs from selected connection" })), readBody: path => Effect.try({ try: () => {
    const body = readFileSync(path === "-" ? 0 : path, "utf8");
    if (Buffer.byteLength(body) > 4 * 1024 * 1024) throw new Error("Body exceeds 4 MiB");
    return body;
  }, catch: () => new IssueInputError({ message: "Issue body cannot be read or exceeds 4 MiB" }) }) });
  const gh = yield* Effect.tryPromise({ try: () => import(ghPath) as Promise<GhModule>, catch: () => new IssueInputError({ message: "GitHub CLI adapter unavailable" }) });
  return yield* gh.withGhIssueTransport(snapshot.root, connection, execute, request => program.pipe(
    Effect.provideService(IssueProject, project), Effect.provideService(IssuePlanStore, makeNodeIssuePlanStore(snapshot.root)), Effect.provideService(IssueRemote, makeGhIssueRemote(owner, repo, request)),
  ));
});
