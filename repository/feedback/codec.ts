import { Result, Schema } from "effect";
import { IssueSchema, type IssueMeta } from "concord-sdlc/model";
import { parseDocument, stringify } from "yaml";
import { FeedbackContentInvalid } from "./errors.js";

export interface FeedbackDocument { readonly metadata: IssueMeta; readonly body: string }

function splitFrontmatter(path: string, source: string): { readonly input: unknown; readonly body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(source);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new FeedbackContentInvalid({ operation: "decode", path, message: "missing YAML frontmatter" });
  }
  try {
    const yaml = parseDocument(match[1], { uniqueKeys: true, merge: false });
    if (yaml.errors.length > 0) throw new Error(yaml.errors.map(error => error.message).join('; '));
    return { input: yaml.toJS({ maxAliasCount: 0 }) as unknown, body: match[2] };
  }
  catch (cause) {
    throw new FeedbackContentInvalid({ operation: "decode", path, message: cause instanceof Error ? cause.message : String(cause) });
  }
}

export function decodeFeedbackDocument(path: string, source: string): FeedbackDocument {
  const { body, input } = splitFrontmatter(path, source);
  const decoded = Schema.decodeUnknownResult(IssueSchema, { errors: "all", onExcessProperty: "error" })(input);
  if (Result.isFailure(decoded)) throw new FeedbackContentInvalid({
    operation: "decode", path, message: String(decoded.failure),
  });
  if (path !== `docs/issues/${decoded.success.id}.md`) throw new FeedbackContentInvalid({ operation: 'decode', path, message: 'Issue path and metadata identity disagree' });
  return { metadata: decoded.success, body };
}

export function encodeFeedbackDocument(document: FeedbackDocument): string {
  Schema.decodeUnknownSync(IssueSchema, { onExcessProperty: 'error' })(document.metadata);
  return `---\n${stringify(document.metadata, { lineWidth: 0 }).trimEnd()}\n---\n${document.body}`;
}
