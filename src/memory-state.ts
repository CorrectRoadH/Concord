import { ConcordError, type HistoryEntry, type MemoryMeta, type Resolution } from './shared.js';

const required = (value: string, field: string): string => {
  if (!value || value.trim() !== value) throw new ConcordError('InvalidInput', `${field} must be non-empty and have no surrounding whitespace`);
  return value;
};

const history = (action: string, reason: string, at: string, ref?: string, resolution?: Resolution): HistoryEntry => ({
  at, action, reason: required(reason, 'reason'), ...(ref === undefined ? {} : { ref }), ...(resolution === undefined ? {} : { resolution }),
});

/** Pure lifecycle transitions derived from NiceEval's memory/state.ts. */
export function resolvedMemory(memory: MemoryMeta, resolution: Resolution): MemoryMeta {
  if (memory.memoryKind !== 'problem') throw new ConcordError('InvalidMemoryState', 'Only Problem Memory can be resolved');
  if (memory.state !== 'open') throw new ConcordError('InvalidMemoryState', 'Problem Memory is already resolved');
  if (resolution.epoch !== memory.epoch) throw new ConcordError('InvalidProof', 'Resolution evidence belongs to a different Problem epoch');
  return { ...memory, state: 'resolved', resolution, history: [...memory.history, history('resolve', resolution.reason, resolution.at, undefined, resolution)] };
}

export function reopenedMemory(memory: MemoryMeta, reason: string, at: string): MemoryMeta {
  if (memory.memoryKind !== 'problem') throw new ConcordError('InvalidMemoryState', 'Only Problem Memory can be reopened');
  if (memory.state !== 'resolved' || memory.resolution === undefined) throw new ConcordError('InvalidMemoryState', 'Only a resolved Problem Memory can be reopened');
  const previous = memory.resolution;
  const { resolution: _resolution, ...withoutResolution } = memory;
  return { ...withoutResolution, state: 'open', epoch: memory.epoch + 1, history: [...memory.history, history('reopen', reason, at, undefined, previous)] };
}

export function promotedMemory(memory: MemoryMeta, target: string): MemoryMeta {
  if (memory.state === 'superseded') throw new ConcordError('InvalidMemoryState', 'Superseded Memory cannot gain a promotion');
  if (memory.promotions.includes(target)) throw new ConcordError('DuplicatePromotion', `Promotion is already current: ${target}`);
  return { ...memory, promotions: [...memory.promotions, target] };
}

export function retiredPromotion(memory: MemoryMeta, target: string, reason: string, at: string): MemoryMeta {
  if (!memory.promotions.includes(target)) throw new ConcordError('PromotionNotFound', `Promotion is not current: ${target}`);
  return {
    ...memory,
    promotions: memory.promotions.filter(value => value !== target),
    history: [...memory.history, history('retire-promotion', reason, at, target)],
  };
}

export function supersededMemory(memory: MemoryMeta, replacement: MemoryMeta, replacementRef: string, reason: string, at: string): MemoryMeta {
  if (memory.id === replacement.id) throw new ConcordError('InvalidMemoryState', 'Memory cannot supersede itself');
  if (memory.memoryKind === 'problem' || replacement.memoryKind !== memory.memoryKind) {
    throw new ConcordError('InvalidMemoryState', 'Only Decision or Insight Memory of the same kind may supersede an entry');
  }
  if (memory.state !== 'current') throw new ConcordError('InvalidMemoryState', 'Only current Memory can be superseded');
  if (replacement.state !== 'current') throw new ConcordError('InvalidMemoryState', 'Replacement Memory must still be current');
  const retired = memory.promotions.map(target => history('retire-promotion', reason, at, target));
  return {
    ...memory,
    state: 'superseded',
    supersededBy: replacementRef,
    promotions: [],
    history: [...memory.history, ...retired, history('supersede', reason, at, replacementRef)],
  };
}

export function lifecycleHistory(action: string, reason: string, at: string, ref?: string): HistoryEntry {
  return history(action, reason, at, ref);
}
