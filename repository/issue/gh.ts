import { Effect, Schema } from "effect";
import type { IssueRemoteService } from "./domain.js";
import { ConnectionIdentityMismatch, IssueMutationUncertain, IssueRemoteBudgetExceeded, type IssueGhError } from "./errors.js";
import type { IssuePlanReceipt, RemoteIssue } from "./model.js";
export type IssueGhRequest = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, payload?: unknown) => Effect.Effect<{ readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: unknown }, IssueGhError>;
const IssueSchema = Schema.Struct({ number: Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)), html_url: Schema.String, title: Schema.String, body: Schema.NullOr(Schema.String), state: Schema.Literals(["open", "closed"]), labels: Schema.Array(Schema.Union([Schema.String, Schema.Struct({ name: Schema.String })])), pull_request: Schema.optional(Schema.Unknown) });
const RepositorySchema = Schema.Struct({ id: Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)), full_name: Schema.String });
const protocol = (): IssueGhError => ({ code: "GhProtocolInvalid", message: "GitHub returned invalid Issue data" });
export function makeGhIssueRemote(owner: string, repo: string, request: IssueGhRequest): IssueRemoteService {
  const prefix = `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  let pages = 0;
  let last: RemoteIssue | undefined;
  const decodeIssue = (body: unknown) => Effect.try({ try: () => {
    const item = Schema.decodeUnknownSync(IssueSchema, { onExcessProperty: "ignore" })(body);
    const url = new URL(item.html_url);
    if (url.origin !== "https://github.com" || url.pathname !== `/${owner}/${repo}/${item.pull_request === undefined ? "issues" : "pull"}/${item.number}`) throw new Error("Issue scope differs");
    return { host: "github.com" as const, repository: `${owner}/${repo}`, number: item.number, url: item.html_url, title: item.title, body: item.body ?? "", state: item.state, labels: item.labels.map(label => typeof label === "string" ? label : label.name), isPullRequest: item.pull_request !== undefined };
  }, catch: protocol });
  return {
    verifyRepository: (_repository, expected) => Effect.gen(function*() {
      const response = yield* request("GET", prefix);
      const actual = yield* Effect.try({ try: () => Schema.decodeUnknownSync(RepositorySchema, { onExcessProperty: "ignore" })(response.body), catch: protocol });
      if (String(actual.id) !== expected || actual.full_name.toLowerCase() !== `${owner}/${repo}`.toLowerCase()) return yield* Effect.fail(new ConnectionIdentityMismatch({ message: "The GitHub repository identity no longer matches the connection" }));
    }),
    list: (_repository, state) => Effect.gen(function*() {
      const items: RemoteIssue[] = [];
      for (let page = 1; ; page++) {
        if (++pages > 200) return yield* Effect.fail(new IssueRemoteBudgetExceeded({ message: "Issue scan exceeded 200 pages" }));
        const response = yield* request("GET", `${prefix}/issues?state=${state}&per_page=100&page=${page}`);
        const raw = yield* Effect.try({ try: () => Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))(response.body), catch: protocol });
        for (const item of raw) items.push(yield* decodeIssue(item));
        const link = Object.entries(response.headers).find(([name]) => name.toLowerCase() === "link")?.[1];
        if (!(link?.includes('rel="next"') ?? raw.length === 100)) break;
      }
      return items;
    }),
    get: identity => Effect.gen(function*() {
      last = yield* decodeIssue((yield* request("GET", `${prefix}/issues/${identity.number}`)).body);
      if (last.number !== identity.number) return yield* Effect.fail(protocol());
      return last;
    }),
    mutate: receipt => Effect.gen(function*() {
      const { method, path, body } = issueWriteRequest(prefix, receipt);
      const uncertain = () => new IssueMutationUncertain({ message: `Issue write result is uncertain; do not retry. Re-plan${receipt.operation === "comment-add" || receipt.operation === "create" && "kind" in receipt.identity && receipt.identity.kind === "manual" ? " only after manually checking the remote Issue" : ""}.`, details: { receiptId: receipt.id, issueOperation: receipt.operation, target: `${receipt.repository.repository}${"number" in receipt.identity ? `#${receipt.identity.number}` : ""}`, method, path } });
      const response = yield* request(method, path, body).pipe(Effect.mapError(cause => cause.code === "IssueMutationUncertain" ? uncertain() : cause));
      if (["create", "body-set", "close", "reopen"].includes(receipt.operation)) {
        const issue = yield* decodeIssue(response.body).pipe(Effect.mapError(uncertain));
        if (issue.isPullRequest || ("number" in receipt.identity && issue.number !== receipt.identity.number)) return yield* Effect.fail(uncertain());
        return { issue };
      }
      if (last === undefined) return yield* Effect.fail(uncertain());
      if (receipt.payload.operation === "labels-add" || receipt.payload.operation === "labels-remove") {
        const labels = yield* Effect.try({ try: () => Schema.decodeUnknownSync(Schema.Array(Schema.Union([Schema.String, Schema.Struct({ name: Schema.String })])), { onExcessProperty: "ignore" })(response.body), catch: uncertain });
        return { issue: { ...last, labels: labels.map(label => typeof label === "string" ? label : label.name) } };
      }
      yield* Effect.try({ try: () => Schema.decodeUnknownSync(Schema.Struct({ id: Schema.Int, body: Schema.String }), { onExcessProperty: "ignore" })(response.body), catch: uncertain });
      return { issue: last };
    }),
  };
}
function issueWriteRequest(prefix: string, receipt: IssuePlanReceipt): { method: "POST" | "PATCH" | "DELETE"; path: string; body: unknown } {
  const payload = receipt.payload;
  const target = `${prefix}/issues${"number" in receipt.identity ? `/${receipt.identity.number}` : ""}`;
  switch (payload.operation) {
    case "create": return { method: "POST", path: target, body: { title: payload.title, body: payload.body } };
    case "body-set": return { method: "PATCH", path: target, body: { body: payload.body } };
    case "close": return { method: "PATCH", path: target, body: { state: "closed", ...(payload.reason === undefined ? {} : { state_reason: payload.reason }) } };
    case "reopen": return { method: "PATCH", path: target, body: { state: "open" } };
    case "labels-add": return { method: "POST", path: `${target}/labels`, body: { labels: payload.labels } };
    case "labels-remove": return { method: "DELETE", path: `${target}/labels/${encodeURIComponent(payload.labels[0]!)}`, body: {} };
    case "comment-add": return { method: "POST", path: `${target}/comments`, body: { body: payload.body } };
  }
}
