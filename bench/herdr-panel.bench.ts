import { defineBenchmarks } from '../scripts/perf/scenario.js';

export default defineBenchmarks('herdr-panel', [
  { id: 'herdr-panel/first-screen', consumer: 'fixture:panel', state: 'warm', server: 'running', run: { terminal: 'first-screen' }, expect: { exitCode: 0 } },
  { id: 'herdr-panel/push', consumer: 'fixture:panel', state: 'warm', server: 'running', run: { terminal: 'push' }, expect: { exitCode: 0 } },
]);
