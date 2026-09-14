import { Result, Schema, SchemaIssue } from "effect";
import { parse, stringify } from "yaml";

import type { RepoRef } from "../trace/ref.js";
import { DesignInputInvalid } from "./errors.js";
import type { DesignDecisionState } from "./model.js";

const DesignReadmeSchema = Schema.Struct({
  format: Schema.Literal("concord.document/v1"),
  id: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u))),
  title: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  createdAt: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  kind: Schema.Literal("design"),
  alternatives: Schema.NonEmptyArray(Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)))),
  decision: Schema.optional(Schema.Struct({ selected: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u))), reason: Schema.String.pipe(Schema.check(Schema.isMinLength(1))), at: Schema.String.pipe(Schema.check(Schema.isMinLength(1))), targets: Schema.Array(Schema.String) })),
});

export interface DecodedDesignReadme {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly alternatives: readonly string[];
  readonly body: string;
  readonly state: DesignDecisionState;
  readonly decides: readonly string[];
}

function failure(path: string, message: string): DesignInputInvalid {
  return new DesignInputInvalid({ source: path, message });
}

export function decodeDesignReadme(path: string, source: string): DecodedDesignReadme {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(source);
  if (match?.[1] === undefined || match[2] === undefined) throw failure(path, "Design README must have one closed YAML frontmatter block");
  let input: unknown;
  try {
    input = parse(match[1]) as unknown;
  } catch (cause) {
    throw failure(path, cause instanceof Error ? cause.message : String(cause));
  }
  const decoded = Schema.decodeUnknownResult(DesignReadmeSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input);
  if (Result.isFailure(decoded)) {
    throw failure(path, SchemaIssue.makeFormatterDefault()(decoded.failure.issue));
  }
  const metadata = decoded.success;
  const selected = metadata.decision?.selected;
  return {
    id: metadata.id,
    title: metadata.title,
    createdAt: metadata.createdAt,
    alternatives: metadata.alternatives,
    body: match[2],
    state: selected === undefined
      ? { _tag: "undecided" }
      : { _tag: "decided", selectedPlan: `${path.slice(0, path.lastIndexOf("/"))}/plans/${selected}/README.md` },
    decides: metadata.decision?.targets ?? [],
  };
}

export function encodeDecidedDesignReadme(
  decoded: DecodedDesignReadme,
  selectedPlan: RepoRef,
  body: string,
): string {
  const selected = selectedPlan.split("/").at(-2);
  if (selected === undefined || !decoded.alternatives.includes(selected)) {
    throw failure(decoded.id, "selected Design alternative is not declared by the owner");
  }
  const frontmatter = stringify({
    format: "concord.document/v1",
    id: decoded.id,
    title: decoded.title,
    createdAt: decoded.createdAt,
    kind: "design",
    alternatives: decoded.alternatives,
    decision: {
      selected,
      reason: "Design option selected by the repository profile.",
      at: new Date().toISOString(),
      targets: decoded.decides,
    },
  }, { lineWidth: 0 }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${body.replace(/^\r?\n/u, "")}`;
}
