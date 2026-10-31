import { defineBenchmarks } from '../scripts/perf/scenario.js';
export default defineBenchmarks('project-onboarding', [...['config', 'constitution', 'doctor'].map(command => ({
  id: `project-onboarding/${command}`, consumer: 'self' as const, state: 'warm' as const, run: command === 'doctor' ? [command] : [command, 'show'], expect: { exitCode: 0 },
})), { id: 'project-onboarding/constitution-server', consumer: 'self', state: 'warm', server: 'running', run: ['constitution', 'show'], expect: { exitCode: 0 } }]);
