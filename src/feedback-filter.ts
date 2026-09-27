// @concord-file
// @concord-implements docs/feature/feedback/use-case/manage-local-observations.md
import { Schema } from 'effect';
import type { FeedbackItem } from './feedback-schema.js';

export const FeedbackFilterFields = {
  state: Schema.optional(Schema.Literals(['draft', 'closed'])),
  provider: Schema.optional(Schema.Literals(['local', 'github', 'linear'])),
  triage: Schema.optional(Schema.Literals(['pending', 'linked', 'closed'])),
  query: Schema.optional(Schema.String),
};
export const FeedbackFilterSchema = Schema.Struct(FeedbackFilterFields);
export type FeedbackFilter = typeof FeedbackFilterSchema.Type;

export function matchesFeedback(item: FeedbackItem, filter: FeedbackFilter): boolean {
  if (filter.state !== undefined && item.document.metadata.state !== filter.state) return false;
  if (filter.provider !== undefined && item.provider !== filter.provider) return false;
  if (filter.triage !== undefined && item.triage !== filter.triage) return false;
  const query = filter.query?.trim().toLocaleLowerCase();
  if (!query) return true;
  const source = item.document.metadata.source;
  return [item.document.metadata.id, item.document.metadata.title, item.document.body, source?.url, source?.title, source?.body, item.remote?.url, item.remote?.title, item.remote?.body, item.provider]
    .filter(value => value !== undefined).join('\n').toLocaleLowerCase().includes(query);
}
