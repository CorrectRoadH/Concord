import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from './temporary.ts';
import { LocalRepository } from "./repository.ts";

import { renderTypeScriptConfig } from "../../src/base/workspace/index.ts";

export const gitCommand = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 'Concord', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Concord', GIT_COMMITTER_EMAIL: 'test@example.invalid' } }).trim();
export const gitCommit = (root: string, message: string) => { gitCommand(root, 'add', '.'); gitCommand(root, 'commit', '-qm', message); return gitCommand(root, 'rev-parse', 'HEAD'); };
export function createFixConsumer(options: { greenAtDefect?: boolean; runnerSource?: boolean; runner?: 'timeout' | 'zero' | 'skipped' | 'signal' | 'move-head' | 'edit-issue' | 'edit-config'; } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'concord-fix-'));
  gitCommand(root, 'init', '-q');
  mkdirSync(join(root, 'docs/feature/cart'), { recursive: true });
  mkdirSync(join(root, 'docs/issues'), { recursive: true });
  writeFileSync(join(root, 'docs/taste.md'), readFileSync(new URL('../../templates/taste.md', import.meta.url), 'utf8'));
  writeFileSync(join(root, 'docs/feature/cart/README.md'), '# Cart\n');
  writeFileSync(join(root, 'docs/issues/sku.md'), '# SKU accumulation\n');
  const repo = new LocalRepository(root);
  writeFileSync(join(root, 'concord.config.ts'), renderTypeScriptConfig({ ...repo.configSnapshot.config, testRoots: ['test'], sourceRoots: ['src'], runner: { kind: 'node-test', sourceFiles: options.runnerSource ? ['runner.ts'] : [], timeoutMs: options.runner === 'timeout' ? 50 : 5000 } }));
  mkdirSync(join(root, 'src'), { recursive: true }); mkdirSync(join(root, 'test'), { recursive: true });
  writeFileSync(join(root, 'src/cart.ts'), `export const quantity = ${options.greenAtDefect ? 2 : 1};\n`);
  if (options.runnerSource) writeFileSync(join(root, 'runner.ts'), '// frozen runner input\n'); repo.close(); gitCommit(root, 'initial');
  writeFileSync(join(root, 'test/cart.test.ts'), `// @feature docs/feature/cart/README.md\n// @issue docs/issues/sku.md\nimport { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { quantity } from '../src/cart.ts';\ntest('quantity accumulates', () => assert.equal(quantity, 2));\n`);
  if (options.runner === 'timeout') writeFileSync(join(root, 'test/cart.test.ts'), readFileSync(join(root, 'test/cart.test.ts'), 'utf8') + '\nsetInterval(() => {}, 1000);\n');
  if (options.runner === 'zero') writeFileSync(join(root, 'test/cart.test.ts'), '// @feature docs/feature/cart/README.md\n// @issue docs/issues/sku.md\n');
  if (options.runner === 'skipped') writeFileSync(join(root, 'test/cart.test.ts'), readFileSync(join(root, 'test/cart.test.ts'), 'utf8').replace("test('quantity", "test.skip('quantity"));
  if (options.runner === 'signal') writeFileSync(join(root, 'test/cart.test.ts'), readFileSync(join(root, 'test/cart.test.ts'), 'utf8') + '\nprocess.kill(process.ppid, "SIGTERM");\n');
  if (options.runner === 'move-head') writeFileSync(join(root, 'test/cart.test.ts'), readFileSync(join(root, 'test/cart.test.ts'), 'utf8') + `\nimport { execFileSync } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\nif (quantity === 2) {\nwriteFileSync(${JSON.stringify(join(root, 'parallel.txt'))}, 'Independent commit\\n');\nexecFileSync('git', ['-C', ${JSON.stringify(root)}, 'add', 'parallel.txt']);\nexecFileSync('git', ['-C', ${JSON.stringify(root)}, '-c', 'user.name=Concord', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'parallel change', '--only', 'parallel.txt']);\n}\n`);
  if (options.runner === 'edit-issue') writeFileSync(join(root, 'test/cart.test.ts'), readFileSync(join(root, 'test/cart.test.ts'), 'utf8') + `\nimport { appendFileSync } from 'node:fs';\nif (quantity === 2) appendFileSync(${JSON.stringify(join(root, 'docs/issues/sku.md'))}, '\\nConcurrent Issue note.\\n');\n`);
  if (options.runner === 'edit-config') writeFileSync(join(root, 'test/cart.test.ts'), readFileSync(join(root, 'test/cart.test.ts'), 'utf8') + `\nimport { writeFileSync } from 'node:fs';\nif (quantity === 2) writeFileSync(${JSON.stringify(join(root, 'concord.config.ts'))}, 'export default {};\\n');\n`);
  const defect = gitCommit(root, 'regression');
  const fix = () => { writeFileSync(join(root, 'src/cart.ts'), 'export const quantity = 2;\n'); return gitCommit(root, 'fix'); };
  return { root, defect, fix };
}
