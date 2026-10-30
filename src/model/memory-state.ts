// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md#lifecycle
import { ConcordError, type MemoryMeta } from "./shared.js";

export function supersededMemory(memory: MemoryMeta, replacement: MemoryMeta, replacementRef: string, reason: string, _at: string): MemoryMeta {
  if (!reason.trim()) throw new ConcordError('InvalidInput', 'Supersession requires a reason');
  if (memory.id === replacement.id || memory.type !== replacement.type || memory.status !== 'current' || replacement.status !== 'current') throw new ConcordError('InvalidMemoryState', 'Supersession requires distinct current Memory of the same type');
  return { ...memory, status: 'superseded', supersededBy: replacementRef };
}
