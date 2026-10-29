import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { io } from '../scripts/perf/process.js';
import { defineBenchmarks } from '../scripts/perf/scenario.js';
const commands: Readonly<Record<string, readonly string[]>> = {
  help: ['--help'], skill: ['--skill'],
  'memory-index': ['memory', 'index'], 'memory-list': ['memory', 'list'], 'memory-recall': ['memory', 'recall', 'HawDB'], 'memory-search': ['memory', 'search', 'HawDB'],
  'issue-index': ['issue', 'index'], 'issue-list': ['issue', 'list'], 'issue-recall': ['issue', 'recall', 'HawDB'],
  'feature-list': ['feature', 'list'], 'use-case-list': ['use-case', 'list'], 'research-list': ['research', 'list'], 'design-list': ['design', 'list'], 'roadmap-list': ['roadmap', 'list'], 'engineering-list': ['engineering', 'list'],
  'docs-check': ['docs', 'check'], 'trace-show-fresh': ['--fresh', 'trace', 'show', 'docs/feature/local-sdlc/README.md'], 'trace-check': ['trace', 'check'], check: ['check'],
  'code-list': ['code', 'list'], 'test-list': ['test', 'list'], 'template-list': ['template', 'list'],

};
const reads = Object.entries(commands).map(([name, run]) => ({
  id: `local-sdlc/${name}`, consumer: 'self' as const, state: 'warm' as const, run, expect: { exitCode: 0 },
}));

const authorArgv = ['--dry-run', 'author', 'set', 'docs/feature/local-sdlc/README.md', '--body', '.git/bench-author.md', '--expected-digest', ''];
export default defineBenchmarks('local-sdlc', [...reads, {
  id: 'local-sdlc/author-preimage', consumer: 'self', state: 'warm', run: authorArgv,
  prepare: context => io('Prepare author CAS preimage', () => {
    const source = readFileSync(join(context.consumer.root, 'docs/feature/local-sdlc/README.md'), 'utf8');
    authorArgv[authorArgv.length - 1] = `sha256:${createHash('sha256').update(source).digest('hex')}`;
    authorArgv[5] = join(context.outputDir, 'author-body.md');
    writeFileSync(authorArgv[5]!, source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, ''));
  }), expect: { exitCode: 0 },
}]);
