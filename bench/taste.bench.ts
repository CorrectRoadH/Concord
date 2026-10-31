import { defineBenchmarks } from '../scripts/perf/scenario.js';
export default defineBenchmarks('taste', [
  { id: 'taste/list', consumer: 'self', state: 'warm', run: ['taste'], expect: { exitCode: 0 } },
  { id: 'taste/list-server', consumer: 'self', state: 'warm', server: 'running', run: ['taste'], expect: { exitCode: 0 } },
]);
