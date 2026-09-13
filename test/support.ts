import { after as nodeAfter, before as nodeBefore } from 'node:test';
import { Effect } from 'effect';

type TestEffect = Effect.Effect<void, unknown, never>;

export const effectBefore = (program: TestEffect): void => {
  nodeBefore(() => Effect.runPromise(program));
};

export const effectAfter = (program: TestEffect): void => {
  nodeAfter(() => Effect.runPromise(program));
};
