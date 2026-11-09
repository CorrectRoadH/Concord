import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from './temporary.ts';
import { LocalRepository } from './repository.ts';

export const source = 'docs/feature/a/use-case/one.md';
export const target = 'docs/feature/b/use-case/two.md';
export const write = (root: string, path: string, contents: string | Uint8Array) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), contents); };

export async function moveFixture(run: (root: string, repo: LocalRepository) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'concord-move-'));
  execFileSync('git', ['init', '-q', root]);
  write(root, 'concord.config.ts', "export default { testRoots: ['test'], sourceRoots: ['src'] };\n");
  write(root, 'docs/taste.md', '# Taste\n');
  write(root, 'docs/feature/a/README.md', '# A\n');
  write(root, 'docs/feature/b/README.md', '# B\n');
  write(root, source, '# One\r\n\r\n1. Run. {#run}\r\n\r\n[owner](../README.md)\r\n![asset](../assets/picture.bin)\r\n');
  write(root, 'docs/feature/a/assets/picture.bin', new Uint8Array([0, 255, 254, 13, 10, 128, 1]));
  write(root, 'docs/feature/a/use-case/README.md', '# Use Cases\n\n[one](one.md#run "title")\n\n[ref]: <one.md#run> "title"\n');
  write(root, 'docs/issues/one.md', `---\nrelations:\n  - role: spec\n    target: '${source}#run' # keep\n---\n\n# Issue\n\n[one](../feature/a/use-case/one.md#run)\n`);
  write(root, 'memory/one.md', `---\nrelations:\n  - role: supports\n    target: ${source}#run\n---\n\n# Memory\n`);
  write(root, 'test/one.test.ts', `// @use-case ${source}#run\r\n// @name one\r\nconst prose = '${source}';\r\n\r\n// @feature docs/feature/a/README.md\r\n// @name package\r\n`);
  write(root, 'src/one.ts', `// @concord-file\n// @concord-implements ${source}#run\nexport const one = 1;\n`);
  write(root, 'notes.txt', `Keep\n${source}\n${source}\n`);
  execFileSync('git', ['-C', root, 'add', '.']);
  const repo = await LocalRepository.open(root, { optimistic: true, persistentCache: 'off' });
  try { await run(root, repo); } finally { repo.close(); rmSync(root, { recursive: true, force: true }); }
}
