import { createDocument } from './operations.ts';
import { createConsumer } from './consumer.ts';
import { LocalRepository } from './repository.ts';
import { readProjectConfig, writeProjectConfig } from './support.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildSync } from 'esbuild';
import type { language_server_config_LanguageServer as LanguageServer } from '../../src/model/index.ts';

export const target = 'docs/feature/sample/use-case/sample.md';
export const source = `# @concord-code\n# @concord-implements ${target}\ndef implementation():\n    return 1\n`;
export function write(root: string, path: string, text: string): void { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); }
export function server(mode = 'normal'): LanguageServer {
  return { id: 'python-fixture', languageId: 'python', extensions: ['.py'], argv: [process.execPath, 'server.mjs'], cwd: ".", environment: ['LANG'], initializationOptions: { mode }, implementationFiles: ['server.mjs'], sourceFiles: [], budgets: { totalMs: 5000, requestMs: 500 }, profile: { version: 'fixture-v1', serverVersion: '1.0.0', commentPrefixes: ['#'], declarationKinds: [5, 6, 12], symbolShape: 'document-symbol', decorators: 'at-line', leadingComments: true, readiness: { kind: 'progress', token: 'index' }, positionEncodings: ['utf-16'] } };
}
export async function consumer(): Promise<string> {
  const root = (await createConsumer());
  writeProjectConfig(root, { testRoots: ['test'], sourceRoots: ['src'] });
  const repository = (await LocalRepository.open(root));
  try {
    (await createDocument(repository, 'feature', { id: 'sample', title: 'Sample' }));
    (await createDocument(repository, 'use-case', { id: 'sample', feature: 'sample', title: 'Sample' }));
  } finally { repository.close(); }
  buildSync({ entryPoints: ['test/fixtures/lsp-server.ts'], bundle: true, platform: 'node', format: 'esm', outfile: join(root, 'server.mjs'), logLevel: 'silent' });
  write(root, 'src/sample.py', source);
  write(root, 'test/sample.py', `# @use-case ${target}\n# @name native-sample\ndef test_sample():\n    helper()\n`);
  write(root, 'test/helper.py', 'def helper():\n    implementation()\n');
  writeProjectConfig(root, { ...(await readProjectConfig(root)), languageServers: [server()] });
  return root;
}

