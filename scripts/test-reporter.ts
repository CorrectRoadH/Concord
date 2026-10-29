import { appendFileSync, writeFileSync } from 'node:fs';
import { tap } from 'node:test/reporters';
import { Effect, Schema } from 'effect';
const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
export const TestCounts = Schema.Struct({
  tests: Count, passed: Count, failed: Count, cancelled: Count,
  skipped: Count, todo: Count, topLevel: Count, suites: Count,
});
import { inspect } from 'node:util';

type TestEvent = Parameters<typeof tap>[0] extends AsyncIterable<infer Event> ? Event : never;

/** Preserve Node's TAP diagnostics and expose file wall times, including hooks. */
export default async function* reporter(events: AsyncIterable<TestEvent>): AsyncGenerator<string, void> {
  async function* measured(): AsyncGenerator<TestEvent, void> {
    for await (const event of events) {
      if (event.type === 'test:fail') {
        Effect.runSync(Effect.sync(() => {
          const error = inspect(event.data.details.error, { depth: 8 });
          if (process.env.CONCORD_TEST_FAILURES !== undefined) appendFileSync(process.env.CONCORD_TEST_FAILURES,
            `${JSON.stringify({ ...event.data, details: { ...event.data.details, error }, error })}\n`);
        }));
      }
      if (event.type === 'test:summary') {
        const file = process.env.CONCORD_TEST_FILE;
        // A file runner owns one OS process group. Keep one summary per file.
        if (file !== undefined && event.data.file !== undefined) { yield event; continue; }
        const timing = { ...event.data, ...(file === undefined ? {} : { file }), scope: file !== undefined || event.data.file !== undefined ? 'file' : 'run' };
        Effect.runSync(Effect.sync(() => {
          if (file !== undefined && process.env.CONCORD_TEST_SUMMARY !== undefined) {
            const counts = Schema.decodeUnknownSync(TestCounts, { onExcessProperty: 'error' })(event.data.counts);
            writeFileSync(process.env.CONCORD_TEST_SUMMARY, JSON.stringify(counts));
          }
          if (process.env.CONCORD_TEST_TIMINGS !== undefined) appendFileSync(process.env.CONCORD_TEST_TIMINGS, `${JSON.stringify(timing)}\n`);
        }));
        yield { type: 'test:diagnostic', data: { nesting: 0, level: 'info', message: `timing ${JSON.stringify(timing)}` } };
      }
      yield event;
    }
  }
  yield* tap(measured());
}
