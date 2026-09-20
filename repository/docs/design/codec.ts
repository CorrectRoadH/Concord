import { Result, Schema, SchemaIssue } from "effect";
import { DesignSchema } from "concord-sdlc/model";
import { parse, stringify } from "yaml";

import type { RepoRef } from "../trace/ref.js";
import { DesignInputInvalid } from "./errors.js";
import type { DesignDecisionState } from "./model.js";

const DesignReadmeSchema = DesignSchema;

export interface DecodedDesignReadme {
  readonly metadata: typeof DesignSchema.Type;
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
    metadata,
    id: metadata.id,
    title: metadata.title,
    createdAt: metadata.createdAt,
    alternatives: metadata.alternatives,
    body: match[2],
    state: selected === undefined
      ? metadata.deferral ? { _tag: "deferred", reason: metadata.deferral.reason } : { _tag: "undecided" }
      : { _tag: "decided", selectedPlan: `${path.slice(0, path.lastIndexOf("/"))}/plans/${selected}/README.md` },
    decides: metadata.decision?.targets ?? [],
  };
}

export function encodeDecidedDesignReadme(
  decoded: DecodedDesignReadme,
  selectedPlan: RepoRef,
  body: string,
  reason = "Design option selected by the repository profile.",
): string {
  const selected = selectedPlan.split("/").at(-2);
  if (selected === undefined || !decoded.alternatives.includes(selected)) {
    throw failure(decoded.id, "selected Design alternative is not declared by the owner");
  }
  const { deferral: _deferral, ...preserved } = decoded.metadata;
  const frontmatter = stringify({
    ...preserved,
    format: "concord.document/v1",
    id: decoded.id,
    title: decoded.title,
    createdAt: decoded.createdAt,
    kind: "design",
    alternatives: decoded.alternatives,
    decision: {
      selected,
      reason,
      at: new Date().toISOString(),
      targets: decoded.decides,
    },
  }, { lineWidth: 0 }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${body.replace(/^\r?\n/u, "")}`;
}
