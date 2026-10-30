import { renderDocsTraceError } from "./repo-docs-trace-command-presentation.js";
import { isTraceError } from "../../model/index.js";
import { type ResearchError } from "../../model/index.js";
import { type ResearchOutcome } from "../../model/index.js";
export function renderResearchOutcome(outcome: ResearchOutcome): string {
  if (outcome.command !== "check" || outcome.ok) return outcome.summary;
  return [outcome.summary, ...outcome.findings.map(finding => `- ${finding.path}: ${finding.message}`)].join("\n");
}
export function renderResearchError(error: ResearchError): string {
  if (isTraceError(error)) return renderDocsTraceError(error);
  switch (error._tag) {
    case "TraceMutationError": return `Research publication ${error.phase}: ${error.message}`;
    case "ResearchInputError": return `Research input is invalid: ${error.message}`;
    case "ResearchPathError": return `Research path ${error.path} is invalid: ${error.message}`;
    case "ResearchConflictError": return `Research target ${error.path} conflicts: ${error.message}`;
    case "ResearchFileError": return `Research ${error.operation} failed for ${error.path}: ${error.message}`;
    case "ResearchFormatError": return `Concord Research format is invalid in ${error.path}: ${error.message}`;
  }
}
