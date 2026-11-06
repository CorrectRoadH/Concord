import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeDocumentSource } from '../../src/domain/documents/index.ts';
import { renderDocument } from '../../src/model/index.ts';
import { createConsumer } from './consumer.ts';
import { writeProjectConfig } from './support.ts';
import { LocalRepository } from './repository.ts';
import { createDocument } from './operations.ts';
import { makeRuntimeEnvironment as makeParserRuntime } from '../../src/base/environment/index.ts';
const parserRuntime = makeParserRuntime(process.cwd(), process.env);


export const ownerPath = 'docs/feature/sample/README.md';
export const flow = 'docs/feature/sample/use-case/flow.md';
/** Real owner bytes shared by source facts and the worker publication boundary. */
export function queryFactsConsumer(): string {
  const root = createConsumer();
  writeProjectConfig(root, { testRoots: ['test'], sourceRoots: ['src'] });
  const repo = new LocalRepository(root);
  try {
    createDocument(repo, 'feature', { id: 'sample', title: 'Sample' });
    createDocument(repo, 'issue', { id: 'remote', title: 'Remote', body: '# Remote\n\nPRIVATE_ISSUE_BODY_SENTINEL\n' });
    createDocument(repo, 'use-case', { id: 'flow', title: 'Flow', feature: 'sample', body: '1. First {#first}\n2. Unmarked\n' });
  } finally { repo.close(); }
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'src/000.ts'), '// @concord-file\n// @concord-implements docs/feature/sample/README.md\nexport const first = 1;\n');
  writeFileSync(join(root, 'test/000.ts'), '// @feature docs/feature/sample/README.md\nexport const first = 1;\n');
  writeFileSync(join(root, 'test/steps.ts'), `// @use-case ${flow}#first\n`);
  writeFileSync(join(root, 'src/steps.ts'), `// @concord-file\n// @concord-implements ${flow}#first\nexport const flow = 1;\n`);
  for (const [path, marker] of [[ownerPath, 'PRIVATE_OWNER_BODY_SENTINEL'], ['docs/taste.md', 'PRIVATE_CONSTITUTION_BODY_SENTINEL']]) {
    writeFileSync(join(root, path!), readFileSync(join(root, path!), 'utf8') + `\n${marker}\n`);
  }
  const issuePath = 'docs/issues/remote.md';
  const issue = decodeDocumentSource(issuePath, readFileSync(join(root, issuePath), 'utf8'), parserRuntime)!;
  assert.equal(issue.metadata.kind, 'issue');
  assert.ok(issue.metadata.kind === 'issue');
  writeFileSync(join(root, issuePath), renderDocument({ ...issue.metadata, source: {
    provider: 'github', instance: 'https://api.github.com', id: '123', url: 'https://github.com/example/example/issues/1', title: 'Remote', body: 'PRIVATE_REMOTE_BODY_SENTINEL', state: 'open', updatedAt: '2026-10-06T00:00:00.000Z', connectionId: 'github', importedAt: '2026-10-06T00:00:00.000Z',
  } }, issue.body));
  return root;
}
