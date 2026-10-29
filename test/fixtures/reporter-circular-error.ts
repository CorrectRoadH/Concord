import test from 'node:test';
import { Effect } from 'effect';

test('intentional circular error fixture', () => Effect.runSync(Effect.sync(() => {
  const error: Error & { error?: Error } = new Error('intentional circular reporter failure');
  error.error = error;
  throw error;
})));
