import { defineBenchmarks, waitForProjection } from '../scripts/perf/scenario.ts';
const queries = { 'trace-gaps': ['trace', 'gaps'], 'trace-show': ['trace', 'show', 'docs/feature/local-sdlc/README.md'], 'review': ['review', 'local-sdlc'] } as const;
export default defineBenchmarks('local-data-engine', [
  ...Object.entries(queries).flatMap(([name, argv]) => [
    { id: `local-data-engine/${name}-warm`, consumer: 'self' as const, state: 'warm' as const, run: argv, prepare: (context: Parameters<typeof waitForProjection>[0]) => waitForProjection(context, argv), expect: { exitCode: 0 } },
    { id: `local-data-engine/${name}-refresh`, consumer: 'scale' as const, state: 'warm' as const, run: { scan: argv }, expect: { exitCode: 0 } },
  ]),
  { id: 'local-data-engine/cache-status', consumer: 'self', state: 'warm', run: ['cache', 'status'], expect: { exitCode: 0 } },
]);
