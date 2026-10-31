import { defineBenchmarks } from '../scripts/perf/scenario.js';

// Actual built mod and public CLI; the external native UI boundary is substituted.
export default defineBenchmarks('herdr-mod', [
  { id: 'herdr-mod/first-screen', consumer: 'fixture:mod', state: 'warm', run: { mod: 'first-screen' }, expect: { exitCode: 0 } },
  { id: 'herdr-mod/push', consumer: 'fixture:mod', state: 'warm', run: { mod: 'push' }, expect: { exitCode: 0 } },
]);
