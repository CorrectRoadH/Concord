import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createConsumer } from './consumer.js';
import { LocalRepository } from "../../src/base/workspace/index.js";
import { createDocument } from "../../src/domain/documents/index.js";
import { renderTypeScriptConfig } from "../../src/base/workspace/index.js";

export const gitCommand = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 'Concord', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Concord', GIT_COMMITTER_EMAIL: 'test@example.invalid' } }).trim();
export const gitCommit = (root: string, message: string) => { gitCommand(root, 'add', '.'); gitCommand(root, 'commit', '-qm', message); return gitCommand(root, 'rev-parse', 'HEAD'); };
export function createFixConsumer(options: { greenAtDefect?: boolean; runnerSource?: boolean; runner?: 'timeout' | 'zero' | 'skipped' | 'signal' | 'move-head'; } = {}) {
  const root = createConsumer(); const repo = new LocalRepository(root);
  createDocument(repo, 'feature', { id: 'cart', title: 'Cart' });
  createDocument(repo, 'issue', { id: 'sku', title: 'SKU accumulation' });
  writeFileSync(join(root, 'concord.config.ts'), renderTypeScriptConfig({ ...repo.configSnapshot.config, testRoots: ['test'], sourceRoots: ['src'], runner: { kind: 'node-test', sourceFiles: options.runnerSource ? ['runner.ts'] : [], timeoutMs: options.runner === 'timeout' ? 50 : 5000 } }));
  mkdirSync(join(root, 'src'), { recursive: true }); mkdirSync(join(root, 'test'), { recursive: true });
  writeFileSync(join(root, 'src/cart.ts'), `export const quantity = ${options.greenAtDefect ? 2 : 1};\n`);
  if (options.runnerSource) writeFileSync(join(root, 'runner.ts'), '// frozen runner input\n'); repo.close(); gitCommit(root, 'initial');
  writeFileSync(join(root, 'test/cart.test.ts'), `// @feature docs/feature/cart/README.md\n// @issue docs/issues/sku.md\nimport { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { quantity } from '../src/cart.ts';\ntest('quantity accumulates', () => assert.equal(quantity, 2));\n`);
  if (options.runner === 'timeout') writeFileSync(join(root, 'test/cart.test.ts'), readFileSync(join(root, 'test/cart.test.ts'), 'utf8') + '\nsetInterval(() => {}, 1000);\n');
  if (options.runner === 'zero') writeFileSync(join(root, 'test/cart.test.ts'), '// @feature docs/feature/cart/README.md\n// @issue docs/issues/sku.md\n');
  if (options.runner === 'skipped') writeFileSync(join(root, 'test/cart.test.ts'), readFileSync(join(root, 'test/cart.test.ts'), 'utf8').replace("test('quantity", "test.skip('quantity"));
  if (options.runner === 'signal') writeFileSync(join(root, 'test/cart.test.ts'), readFileSync(join(root, 'test/cart.test.ts'), 'utf8') + '\nprocess.kill(process.ppid, "SIGTERM");\n');
  if (options.runner === 'move-head') writeFileSync(join(root, 'test/cart.test.ts'), readFileSync(join(root, 'test/cart.test.ts'), 'utf8') + `\nimport { execFileSync } from 'node:child_process';\nif (quantity === 2) execFileSync('git', ['update-ref', 'HEAD', execFileSync('git', ['rev-parse', 'HEAD^'], {encoding:'utf8'}).trim()]);\n`);
  const defect = gitCommit(root, 'regression');
  const fix = () => { writeFileSync(join(root, 'src/cart.ts'), 'export const quantity = 2;\n'); return gitCommit(root, 'fix'); };
  return { root, defect, fix };
}
