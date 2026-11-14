import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from './temporary.ts';

import { renderTypeScriptConfig } from "../../src/base/workspace/index.ts";

export const gitCommand = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_AUTHOR_NAME: 'Concord', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Concord', GIT_COMMITTER_EMAIL: 'test@example.invalid' } }).trim();
export async function createFixConsumer() {
  const root = mkdtempSync(join(tmpdir(), 'concord-issue-'));
  gitCommand(root, 'init', '-q');
  mkdirSync(join(root, 'docs/feature/cart'), { recursive: true });
  mkdirSync(join(root, 'docs/issues'), { recursive: true });
  mkdirSync(join(root, 'test'), { recursive: true });
  writeFileSync(join(root, 'docs/taste.md'), readFileSync(new URL('../../templates/taste.md', import.meta.url), 'utf8'));
  writeFileSync(join(root, 'docs/feature/cart/README.md'), '# Cart\n');
  writeFileSync(join(root, 'docs/issues/sku.md'), '# SKU accumulation\n');
  writeFileSync(join(root, 'concord.config.ts'), renderTypeScriptConfig({ testRoots: ['test'], sourceRoots: [] }));
  writeFileSync(join(root, 'test/cart.test.ts'), '// @feature docs/feature/cart/README.md\n// @issue docs/issues/sku.md\nexport const quantity = 2;\n');
  return { root };
}
