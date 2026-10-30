import { defineBenchmarks } from '../scripts/perf/scenario.js';
const commands: Readonly<Record<string, readonly string[]>> = {
  help: ['--help'], skill: ['--skill'],
  'memory-index': ['memory', 'index'], 'memory-list': ['list', 'memory'], 'memory-recall': ['memory', 'recall', 'HawDB'],
  'issue-index': ['list', 'issue'], 'issue-list': ['list', 'issue'], 'issue-recall': ['issue', 'recall', 'HawDB'],
  'feature-list': ['list', 'feature'], 'use-case-list': ['list', 'use-case'], 'research-list': ['list', 'research'], 'design-list': ['list', 'design'], 'roadmap-list': ['list', 'roadmap'], 'engineering-list': ['list', 'engineering'],
  'docs-check': ['docs', 'check'], 'trace-show-fresh': ['--fresh', 'trace', 'show', 'docs/feature/local-sdlc/README.md'], 'trace-check': ['trace', 'check'], check: ['check'],
  'code-list': ['code', 'list'], 'test-list': ['test', 'list'], 'template-list': ['template', 'list'],

};
const reads = Object.entries(commands).map(([name, run]) => ({
  id: `local-sdlc/${name}`, consumer: 'self' as const, state: 'warm' as const, run, expect: { exitCode: 0 },
}));

export default defineBenchmarks('local-sdlc', reads);
