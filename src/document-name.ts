// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
/** A single path component, preserving the author's Unicode spelling. */
export const DOCUMENT_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:-[\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*$/u;
