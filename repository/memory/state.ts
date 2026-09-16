import { Result } from "effect";
import type { MemoryMeta, Resolution } from "concord-sdlc/model";
import { MemoryReferenceConflict } from "./errors.js";

function conflict(operation: string, message: string): Result.Result<never, MemoryReferenceConflict> { return Result.fail(new MemoryReferenceConflict({ operation, message })); }

export function activateMemory(memory: MemoryMeta, reason: string, at: string, commit?: string): Result.Result<MemoryMeta, MemoryReferenceConflict> {
  if (memory.state !== "captured") return conflict("activate", "only captured Memory can be activated");
  if (memory.memoryKind === "note") return conflict("activate", "note Memory cannot be activated");
  const state = memory.memoryKind === "problem" ? "open" : "current";
  return Result.succeed({ ...memory, state, history: [...memory.history, { action: "activate", at, reason, ...(commit === undefined ? {} : { commit }) }] });
}

export function resolveProblem(memory: MemoryMeta, resolution: Resolution, commit?: string): Result.Result<MemoryMeta, MemoryReferenceConflict> {
  if (memory.memoryKind !== "problem" || memory.state !== "open") return conflict("resolve", "only an open Problem Memory can be resolved");
  if (resolution.epoch !== memory.epoch) return conflict("resolve", "resolution epoch does not match the current Problem epoch");
  return Result.succeed({ ...memory, state: "resolved", resolution, history: [...memory.history, { action: "resolve", at: resolution.at, reason: resolution.reason, ...(commit === undefined ? {} : { commit }), resolution }] });
}

export function reopenProblem(memory: MemoryMeta, reason: string, at: string, commit?: string): Result.Result<MemoryMeta, MemoryReferenceConflict> {
  if (memory.memoryKind !== "problem" || memory.state !== "resolved" || memory.resolution === undefined) return conflict("reopen", "only a resolved Problem Memory can be reopened");
  const { resolution: _resolution, ...open } = memory;
  return Result.succeed({ ...open, state: "open", epoch: memory.epoch + 1, history: [...memory.history, { action: "reopen", at, reason, ...(commit === undefined ? {} : { commit }), resolution: memory.resolution }] });
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
