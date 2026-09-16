import type { MemoryMeta, Resolution } from "concord-sdlc/model";

export type { MemoryMeta, Resolution } from "concord-sdlc/model";
export const PROBLEM_RESOLUTION_KINDS = ["fixed", "not-a-bug", "wont-fix", "external-fixed"] as const;
export const MemoryKind = Object.freeze({ Problem: "problem", Decision: "decision", Insight: "insight", Note: "note" } as const);
export const MEMORY_KINDS = ["problem", "decision", "insight", "note"] as const;
export type ProblemResolutionIntent = {
  readonly kind: Resolution["kind"];
  readonly reason: string;
  readonly at?: string | undefined;
};
export type PromotionKind = "roadmap" | "feature" | "use-case" | "engineering";
export type MemoryDocument = { readonly metadata: MemoryMeta; readonly body: string };
export type StructuredMemoryDocument = MemoryDocument;
