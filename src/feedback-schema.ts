// @concord-file feedback-domain-schema
// @concord-implements docs/feature/feedback/use-case/triage-feedback.md
import { Schema } from 'effect';
import type { DocumentMeta, DocumentRecord } from './shared.js';

const BoundedBody = Schema.String.check(
  Schema.isMaxLength(1024 * 1024),
  Schema.isPattern(/^[^\0]*$/u),
);
const BoundedText = BoundedBody.check(Schema.isMinLength(1));
const TrimmedText = BoundedText.check(Schema.makeFilter((value) => value.trim() === value, { message: 'must not have surrounding whitespace' }));
const ShortText = TrimmedText.check(Schema.isMaxLength(512));
const Slug = Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u));
const CredentialEnvironment = Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/u), Schema.isMaxLength(256));
const CanonicalIntegerId = Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/u), Schema.isMaxLength(16)).check(
  Schema.makeFilter((value) => Number.isSafeInteger(Number(value)), { message: 'must be a positive safe integer encoded canonically' }),
);
const Uuid = Schema.String.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u));
const IsoInstant = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u)).check(
  Schema.makeFilter((value) => Number.isFinite(Date.parse(value)), { message: 'must be a valid UTC ISO-8601 instant' }),
);
const Url = TrimmedText.check(Schema.isMaxLength(8 * 1024), Schema.isPattern(/^https:\/\/[^\s]+$/u));

export const GitHubFeedbackConnectionSchema = Schema.Struct({
  id: Slug,
  provider: Schema.Literal('github'),
  credentialEnv: CredentialEnvironment,
  owner: ShortText,
  repo: ShortText,
  repositoryId: Schema.optional(CanonicalIntegerId),
});
export const LinearFeedbackConnectionSchema = Schema.Struct({
  id: Slug,
  provider: Schema.Literal('linear'),
  credentialEnv: CredentialEnvironment,
  team: ShortText,
  organizationId: Schema.optional(Uuid),
  teamId: Schema.optional(Uuid),
});
export const FeedbackConnectionSchema = Schema.Union([
  GitHubFeedbackConnectionSchema,
  LinearFeedbackConnectionSchema,
]);
export type FeedbackConnection = typeof FeedbackConnectionSchema.Type;

export const FeedbackConnectionsSchema = Schema.Array(FeedbackConnectionSchema).check(
  Schema.makeFilter((connections) => {
    const seen = new Set<string>();
    for (let index = 0; index < connections.length; index++) {
      const id = connections[index]!.id;
      if (seen.has(id)) return { path: [index, 'id'], issue: `connection id ${id} must be unique` };
      seen.add(id);
    }
    return undefined;
  }),
);

const RemoteBase = {
  instance: Url,
  id: TrimmedText.check(Schema.isMaxLength(512)),
  url: Url,
  title: TrimmedText.check(Schema.isMaxLength(4 * 1024)),
  body: BoundedBody,
  state: ShortText,
  updatedAt: IsoInstant,
} as const;
export const GitHubRemoteFeedbackSchema = Schema.Struct({
  provider: Schema.Literal('github'),
  ...RemoteBase,
  instance: Schema.Literal('https://api.github.com'),
  id: CanonicalIntegerId,
  organizationId: Schema.optional(Schema.Never),
});
export const LinearRemoteFeedbackSchema = Schema.Struct({
  provider: Schema.Literal('linear'),
  ...RemoteBase,
  instance: Schema.Literal('https://api.linear.app'),
  organizationId: Uuid,
  id: Uuid,
});
export const RemoteFeedbackSchema = Schema.Union([GitHubRemoteFeedbackSchema, LinearRemoteFeedbackSchema]);
export type RemoteFeedback = typeof RemoteFeedbackSchema.Type;

export const FeedbackSourceSchema = Schema.Union([
  Schema.Struct({ ...GitHubRemoteFeedbackSchema.fields, connectionId: Slug, importedAt: IsoInstant }),
  Schema.Struct({ ...LinearRemoteFeedbackSchema.fields, connectionId: Slug, importedAt: IsoInstant }),
]);
export type FeedbackSource = typeof FeedbackSourceSchema.Type;

export type FeedbackTriage = 'pending' | 'linked' | 'closed';
export type FeedbackAvailability = 'local' | 'cached' | 'unavailable';

export type FeedbackIssueRecord = Omit<DocumentRecord, 'metadata'> & {
  readonly metadata: Extract<DocumentMeta, { readonly kind: 'issue' }>;
};
export interface FeedbackItem {
  readonly document: FeedbackIssueRecord;
  readonly triage: FeedbackTriage;
  readonly remote: RemoteFeedback | null;
  readonly availability: FeedbackAvailability;
  readonly warnings: readonly string[];
}

/** Stable remote identity; display names and mutable repository/team labels are intentionally excluded. */
export function feedbackIdentity(value: RemoteFeedback | FeedbackSource): string {
  return value.provider === 'linear'
    ? `${value.provider}\u0000${value.instance}\u0000${value.organizationId}\u0000${value.id}`
    : `${value.provider}\u0000${value.instance}\u0000${value.id}`;
}
