import { Schema } from "effect";
import { IssueSchema, type IssueMeta } from "./shared.js";
import { decodeUncachedDocumentSource as decodeDocumentSource } from "./document-source.js";
import { renderDocument } from "./document-render.js";
import { FeedbackContentInvalid } from "./repo-feedback-errors.js";
import { documentPlacementError } from "./document-layout.js";

export interface FeedbackDocument { readonly metadata: IssueMeta; readonly body: string }

export function decodeFeedbackDocument(path: string, source: string): FeedbackDocument {
  try {
    const record = decodeDocumentSource(path, source);
    if (record?.metadata.kind !== 'issue') throw new Error('missing concord.document/v1 Issue frontmatter');
    const placement = documentPlacementError('issue', path);
    if (placement !== undefined) throw new Error(placement);
    return { metadata: record.metadata, body: record.body };
  } catch (cause) { throw new FeedbackContentInvalid({ operation: 'decode', path, message: cause instanceof Error ? cause.message : String(cause) }); }
}

export function encodeFeedbackDocument(document: FeedbackDocument): string {
  Schema.decodeUnknownSync(IssueSchema, { onExcessProperty: 'error' })(document.metadata);
  return renderDocument(document.metadata, document.body);
}
