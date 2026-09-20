import { resolvedMemory, reopenedMemory } from "concord-sdlc/memory-state";
import { adoptMemoryEvidenceRequirement } from "concord-sdlc/evidence-policy";
import { Result } from "effect";
import type { MemoryMeta, Resolution } from "concord-sdlc/model";
import { MemoryReferenceConflict } from "./errors.js";

function conflict(operation: string, message: string): Result.Result<never, MemoryReferenceConflict> { return Result.fail(new MemoryReferenceConflict({ operation, message })); }

export function activateMemory(memory: MemoryMeta, reason: string, at: string, commit?: string): Result.Result<MemoryMeta, MemoryReferenceConflict> {
  memory = adoptMemoryEvidenceRequirement(memory);
  if (memory.state !== "captured") return conflict("activate", "only captured Memory can be activated");
  if (memory.memoryKind === "note") return conflict("activate", "note Memory cannot be activated");
  const state = memory.memoryKind === "problem" ? "open" : "current";
  return Result.succeed({ ...memory, state, history: [...memory.history, { action: "activate", at, reason, ...(commit === undefined ? {} : { commit }) }] });
}

function withCommit(memory: MemoryMeta, commit: string | undefined): MemoryMeta {
  return commit === undefined ? memory : { ...memory, history: memory.history.map((entry, index) => index === memory.history.length - 1 ? { ...entry, commit } : entry) };
}

export function resolveProblem(memory: MemoryMeta, resolution: Resolution, commit?: string): Result.Result<MemoryMeta, MemoryReferenceConflict> {
  try { return Result.succeed(withCommit(resolvedMemory(memory, resolution), commit)); }
  catch (cause) { return conflict("resolve", cause instanceof Error ? cause.message : String(cause)); }
}

export function reopenProblem(memory: MemoryMeta, reason: string, at: string, commit?: string): Result.Result<MemoryMeta, MemoryReferenceConflict> {
  try { return Result.succeed(withCommit(reopenedMemory(memory, reason, at), commit)); }
  catch (cause) { return conflict("reopen", cause instanceof Error ? cause.message : String(cause)); }
}

export function supersedeMemory(memory: MemoryMeta, replacement: MemoryMeta, replacementRef: string, reason: string, at: string, commit?: string): Result.Result<MemoryMeta, MemoryReferenceConflict> {
  const sourceEligible = memory.memoryKind === "problem" ? memory.state === "open" || memory.state === "resolved" : memory.state === "current";
  const replacementEligible = replacement.memoryKind === "problem" ? replacement.state === "open" || replacement.state === "resolved" : replacement.state === "current";
  if (memory.id === replacement.id || replacement.memoryKind !== memory.memoryKind || !sourceEligible || !replacementEligible) return conflict("supersede", "supersede requires a same-kind active replacement and source");
  const history = [...memory.history, ...memory.promotions.map((ref) => ({ action: "retire-promotion", at, reason, ...(commit === undefined ? {} : { commit }), ref })), { action: "supersede", at, reason, ...(commit === undefined ? {} : { commit }), ref: replacementRef, ...(memory.resolution === undefined ? {} : { resolution: memory.resolution }) }];
  const { resolution: _resolution, ...withoutResolution } = memory;
  return Result.succeed({ ...withoutResolution, state: "superseded", supersededBy: replacementRef, promotions: [], history });
}

export function promoteMemory(memory: MemoryMeta, target: string, at: string, commit?: string): Result.Result<MemoryMeta, MemoryReferenceConflict> {
  if (memory.state === "captured" || memory.memoryKind === "note") return conflict("promote", "captured or note Memory cannot be promoted");
  if (memory.state === "superseded") return conflict("promote", "superseded Memory cannot be promoted");
  if (memory.promotions.includes(target)) return conflict("promote", "promotion is already current");
  return Result.succeed({ ...memory, promotions: [...memory.promotions, target], history: [...memory.history, { action: "promote", at, reason: "promote", ...(commit === undefined ? {} : { commit }), ref: target }] });
}

export function retirePromotion(memory: MemoryMeta, target: string, reason: string, at: string, commit?: string): Result.Result<MemoryMeta, MemoryReferenceConflict> {
  if (!memory.promotions.includes(target)) return conflict("retire", "promotion is not current");
  return Result.succeed({ ...memory, promotions: memory.promotions.filter((item) => item !== target), history: [...memory.history, { action: "retire-promotion", at, reason, ...(commit === undefined ? {} : { commit }), ref: target }] });
}
