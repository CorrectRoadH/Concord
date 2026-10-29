import { defineBenchmarks } from '../scripts/perf/scenario.js';
export default defineBenchmarks('neutral-project-governance', [{ id: 'neutral-project-governance/repo-features', consumer: 'fixture:minimal', state: 'warm', run: ['repo', 'docs', 'feature', 'list', '--json'], expect: { exitCode: 0 } }]);
