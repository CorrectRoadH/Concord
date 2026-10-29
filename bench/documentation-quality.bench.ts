import { defineBenchmarks } from '../scripts/perf/scenario.js';
export default defineBenchmarks('documentation-quality', [
  { id: 'documentation-quality/docs-check', consumer: 'fixture:writing', state: 'warm', run: ['docs', 'check'], expect: { exitCode: 0 } },
  { id: 'documentation-quality/check', consumer: 'fixture:writing', state: 'warm', run: ['check'], expect: { exitCode: 0 } },
  { id: 'documentation-quality/docs-check-scale', consumer: 'fixture:writing-scale', state: 'warm', run: ['docs', 'check'], expect: { exitCode: 0 } },
  ...['writing', 'concepts'].map(command => ({ id: `documentation-quality/${command}-index`, consumer: 'self' as const, state: 'warm' as const, run: [command, 'index'], expect: { exitCode: 0 } })),
]);
