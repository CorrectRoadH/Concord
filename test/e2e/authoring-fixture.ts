import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setMarkdown } from '../../src/app/index.ts';
import { digest } from '../../src/model/index.ts';
import { LocalRepository } from '../support/repository.ts';
import { addPage, createDocument } from '../support/operations.ts';
import { writeProjectConfig } from '../support/support.ts';

/** Add the authoring scenario to the worker's restored consumer. */
export async function prepareAuthoringFixture(root: string): Promise<void> {
  writeProjectConfig(root, { testRoots: ['test'], sourceRoots: ['src'], runner: { kind: 'command', argv: ['bun', 'test', '--no-env-file', '--config=/dev/null', '--timeout=15000', '{file}'], timeoutMs: 15000, sourceFiles: [] } });
  const repo = (await LocalRepository.open(root));
  try {
    (await createDocument(repo, 'engineering', { id: 'build', title: 'Build workflow' }));
    const engineeringPath = 'docs/engineering/build/README.md';
    const source = readFileSync(join(root, engineeringPath), 'utf8');
    (await setMarkdown(repo, engineeringPath, `${source}\n\`\`\`mermaid\nflowchart LR\n  Source --> Result\n\`\`\`\n`, digest(source)));
    (await addPage(repo, 'engineering', 'build', 'architecture'));
    const architecturePath = 'docs/engineering/build/architecture.md';
    (await setMarkdown(repo, architecturePath, '# Architecture\n\n## Source\n', digest(readFileSync(join(root, architecturePath), 'utf8'))));
    (await createDocument(repo, 'roadmap', { id: 'future', title: 'Future direction', pages: ['architecture'] }));
    (await createDocument(repo, 'design', { id: 'options', title: 'Design options' }));
  } finally { repo.close(); }
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/demo.ts'), '// @concord-code\n// @concord-implements docs/engineering/build/architecture.md#source\nexport function demo() { return 1; }\n');
}
