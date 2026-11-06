import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setMarkdown } from '../../src/app/index.ts';
import { digest } from '../../src/model/index.ts';
import { LocalRepository } from '../support/repository.ts';
import { addPage, createDocument } from '../support/operations.ts';
import { writeProjectConfig } from '../support/support.ts';

/** Add the authoring scenario to the worker's restored consumer. */
export function prepareAuthoringFixture(root: string): void {
  writeProjectConfig(root, { testRoots: ['test'], sourceRoots: ['src'], runner: { kind: 'command', argv: [process.execPath, '--test', '{file}'], timeoutMs: 15000, sourceFiles: [] } });
  const repo = new LocalRepository(root);
  try {
    createDocument(repo, 'engineering', { id: 'build', title: 'Build workflow' });
    const engineeringPath = 'docs/engineering/build/README.md';
    const source = readFileSync(join(root, engineeringPath), 'utf8');
    setMarkdown(repo, engineeringPath, `${source}\n\`\`\`mermaid\nflowchart LR\n  Source --> Result\n\`\`\`\n`, digest(source));
    addPage(repo, 'engineering', 'build', 'architecture');
    const architecturePath = 'docs/engineering/build/architecture.md';
    setMarkdown(repo, architecturePath, '# Architecture\n\n## Source\n', digest(readFileSync(join(root, architecturePath), 'utf8')));
    createDocument(repo, 'roadmap', { id: 'future', title: 'Future direction', pages: ['architecture'] });
    createDocument(repo, 'design', { id: 'options', title: 'Design options' });
  } finally { repo.close(); }
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/demo.ts'), '// @concord-code\n// @concord-implements docs/engineering/build/architecture.md#source\nexport function demo() { return 1; }\n');
}
