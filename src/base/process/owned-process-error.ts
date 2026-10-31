import { Data } from 'effect';

export class OwnedProcessError extends Data.TaggedError('OwnedProcessError')<{
  readonly operation: 'spawn' | 'observe' | 'resolve';
  readonly detail: string;
}> {}
