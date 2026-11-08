import { defineBenchmarks } from '../scripts/perf/scenario.ts';

// Actual built mod and public CLI; the external native UI boundary is substituted.
export default defineBenchmarks('herdr-mod', [
  { id: 'herdr-mod/first-screen', consumer: 'fixture:mod', state: 'warm', run: { mod: 'first-screen' }, expect: { exitCode: 0 } },
  { id: 'herdr-mod/switch-back', consumer: 'fixture:mod', server: 'running', state: 'warm', run: { mod: 'switch-back' }, expect: { exitCode: 0 } },
  { id: 'herdr-mod/switch-new', consumer: 'fixture:mod', server: 'running', state: 'warm', run: { mod: 'switch-new' }, expect: { exitCode: 0 } },
  { id: 'herdr-mod/push', consumer: 'fixture:mod', state: 'warm', run: { mod: 'push' }, expect: { exitCode: 0 } },
]);
