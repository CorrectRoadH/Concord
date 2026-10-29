import { defineBenchmarks } from '../scripts/perf/scenario.js';
export default defineBenchmarks('feedback', [{ id: 'feedback/list', consumer: 'self', state: 'warm', run: ['feedback', 'list'], expect: { exitCode: 0 } }]);
