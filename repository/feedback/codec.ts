import { Schema } from "effect";
import { IssueSchema, type IssueMeta } from "concord-sdlc/model";
import { stringify } from "yaml";
import { decodeDocumentSource } from 'concord-sdlc/document-codec';
import { FeedbackContentInvalid } from "./errors.js";
import { documentPlacementError } from 'concord-sdlc/document-layout';

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
  return `---\n${stringify(document.metadata, { lineWidth: 0, aliasDuplicateObjects: false }).trimEnd()}\n---\n${document.body}`;
}
