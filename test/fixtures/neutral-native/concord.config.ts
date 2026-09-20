import type { ProjectConfig } from 'concord-sdlc/config';

export default {
  format: 'concord.project/v1',
  projectId: 'public-calculator',
  testRoots: ['acceptance'],
  sourceRoots: ['src'],
  runner: {
    kind: 'command',
    argv: ['node', 'node_modules/vitest/vitest.mjs', 'run', '{file}', '--testNamePattern', '{pattern}', '--reporter=json', '--retry=0', '--maxWorkers=1', '--no-file-parallelism'],
    sourceFiles: [],
    timeoutMs: 30_000
  }
} as const satisfies ProjectConfig;
