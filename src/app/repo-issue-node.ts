import * as storage from '../base/workspace/index.ts';
import * as gh from '../domain/feedback/index.ts';
import { Sources } from '../base/sources/index.ts';
import type { Publication } from '../base/publication/index.ts';
import type { OwnedProcess } from '../base/process/index.ts';
import { Effect } from "effect";
import { IssueProject } from "../domain/issues/index.ts";
import type { IssueCommandRunner } from "./issue-operations.ts";
import { IssuePlanStore, IssueRemote } from "../domain/issues/index.ts";
import { makeNodeIssuePlanStore } from "./issue-plan-store.ts";
import { makeGhIssueRemote } from "../domain/issues/index.ts";
import { IssueConnectionUnbound, IssueInputError, IssueRemoteTransportUnsupported } from "../model/index.ts";
export const makeNodeIssueCommandRunner = (root: string | undefined): IssueCommandRunner<storage.Workspace | Sources | Publication | OwnedProcess> => (connectionId, execute, program) => Effect.gen(function*() {
  const sources = yield* Sources;
  const snapshot = yield* Effect.scoped(Effect.map(storage.openReadRepository(root, { access: 'read', optimistic: true }), repo => ({ root: repo.root, connections: repo.config.feedbackConnections ?? [] })));
  const connection = snapshot.connections.find(item => item.id === connectionId);
  if (connection === undefined) return yield* Effect.fail(new IssueInputError({ message: "Unknown feedback connection" }));
  if (connection.provider !== "github" || connection.transport !== "gh") return yield* Effect.fail(new IssueRemoteTransportUnsupported({ message: "Remote Issue writes require a GitHub CLI connection" }));
  if (!connection.repositoryId) return yield* Effect.fail(new IssueConnectionUnbound({ message: "Connection must bind repositoryId before remote Issue writes" }));
  const owner = connection.owner!;
  const repo = connection.repo!;
  const binding = { connection: connectionId, repositoryId: connection.repositoryId, repository: { host: "github.com" as const, repository: `${owner}/${repo}` } };
  const project = IssueProject.of({ connection: id => id === connectionId ? Effect.succeed(binding) : Effect.fail(new IssueInputError({ message: "Connection differs from selected connection" })), readBody: path => sources.authorBody(path).pipe(Effect.mapError(() => new IssueInputError({ message: 'Issue body cannot be read or exceeds 4 MiB' }))) });
  const planStore = yield* makeNodeIssuePlanStore(snapshot.root);
  return yield* gh.withGhIssueTransport(snapshot.root, connection, execute, request => program.pipe(
    Effect.provideService(IssueProject, project), Effect.provideService(IssuePlanStore, planStore), Effect.provideService(IssueRemote, makeGhIssueRemote(owner, repo, request)),
  ));
});
