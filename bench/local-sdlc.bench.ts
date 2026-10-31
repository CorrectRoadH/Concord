import { defineBenchmarks } from '../scripts/perf/scenario.js';
const commands: Readonly<Record<string, readonly string[]>> = {
  help: ['--help'], skill: ['--skill'],
  'memory-list': ['list', 'memory'], 'memory-search': ['memory', 'search', 'HawDB'],
  'issue-list': ['list', 'issue'], 'issue-search': ['issue', 'search', 'HawDB'],
  'feature-list': ['list', 'feature'], 'use-case-list': ['list', 'use-case'], 'design-list': ['list', 'design'], 'roadmap-list': ['list', 'roadmap'], 'engineering-list': ['list', 'engineering'],
  'docs-check': ['docs', 'check'], 'trace-show-fresh': ['--fresh', 'trace', 'show', 'docs/feature/local-sdlc/README.md'], 'trace-check': ['trace', 'check'], check: ['check'],
  'code-list': ['code', 'list'], 'test-list': ['test', 'list'], 'template-list': ['template', 'list'],

};
const helpEnvironment: NodeJS.ProcessEnv = { NO_COLOR: '1', TERM: 'dumb', FORCE_COLOR: undefined, NODE_DISABLE_COMPILE_CACHE: '1', NODE_COMPILE_CACHE: undefined, NODE_OPTIONS: '' };
const reads = Object.entries(commands).map(([name, run]) => ({
  id: `local-sdlc/${name}`, consumer: 'self' as const, state: 'warm' as const, run, ...(name === 'help' ? { env: helpEnvironment } : {}), expect: { exitCode: 0 },
}));

export default defineBenchmarks('local-sdlc', [...reads, ...['trace-check', 'trace-show-fresh', 'check'].map(name => ({
  id: `local-sdlc/${name}-server`, consumer: 'self' as const, state: 'warm' as const, server: 'running' as const,
  run: commands[name]!, expect: { exitCode: 0 },
}))]);
