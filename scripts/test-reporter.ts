import { appendFileSync } from 'node:fs';
import { tap } from 'node:test/reporters';
import { Effect } from 'effect';

type TestEvent = Parameters<typeof tap>[0] extends AsyncIterable<infer Event> ? Event : never;

/** Preserve Node's TAP diagnostics and expose file wall times, including hooks. */
export default async function* reporter(events: AsyncIterable<TestEvent>): AsyncGenerator<string, void> {
  async function* measured(): AsyncGenerator<TestEvent, void> {
    for await (const event of events) {
      if (event.type === 'test:summary') {
        const timing = { ...event.data, scope: event.data.file === undefined ? 'run' : 'file' };
        Effect.runSync(Effect.sync(() => {
          if (process.env.CONCORD_TEST_TIMINGS !== undefined) appendFileSync(process.env.CONCORD_TEST_TIMINGS, `${JSON.stringify(timing)}\n`);
        }));
        yield { type: 'test:diagnostic', data: { nesting: 0, level: 'info', message: `timing ${JSON.stringify(timing)}` } };
      }
      yield event;
    }
  }
  yield* tap(measured());
}
