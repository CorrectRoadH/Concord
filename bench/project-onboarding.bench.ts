import { defineBenchmarks } from '../scripts/perf/scenario.js';
export default defineBenchmarks('project-onboarding', ['config', 'constitution', 'doctor'].map(command => ({
  id: `project-onboarding/${command}`, consumer: 'self', state: 'warm', run: command === 'doctor' ? [command] : [command, 'show'], expect: { exitCode: 0 },
})));
