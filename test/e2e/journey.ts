import { Effect } from 'effect';
import type { TestFixtures } from 'e2e';

/** Both execution modes share the scenario's exact assertions and fixture. */
export const journeyAction = Effect.fn('journeyAction')((
  fixtures: TestFixtures,
  instruction: string,
  deterministic: () => Promise<void>,
) => Effect.tryPromise(async () => {
  if (process.env.CONCORD_E2E_AGENT === '1') await fixtures.agent.act(instruction);
  else await deterministic();
}));

export const act = (fixtures: TestFixtures, instruction: string, deterministic: () => Promise<void>): Promise<void> =>
  Effect.runPromise(journeyAction(fixtures, instruction, deterministic));
