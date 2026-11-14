import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from './temporary.ts';
import { join } from 'node:path';
import { after } from 'node:test';
import { defaultWritingSource } from '../../src/model/index.ts';
import { writeProjectConfig } from './support.ts';
export function git(root: string, ...args: string[]) { const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); }
function buildFixture(docsWork?: unknown, initialConfig = true) {
  const root = mkdtempSync(join(tmpdir(), 'concord-docs-work-'));
  git(root, 'init', '-q'); git(root, 'config', 'user.name', 'Docs Work'); git(root, 'config', 'user.email', 'docs-work@example.test');
  mkdirSync(join(root, 'docs/a'), { recursive: true }); mkdirSync(join(root, 'docs/b'));
  writeFileSync(join(root, 'docs/a/one.md'), '# One\n\nClear text.\n'); writeFileSync(join(root, 'docs/b/two.md'), '# Two\n\nClear text.\n');
  writeFileSync(join(root, 'docs/README.md'), '# Documentation\n');
  if (initialConfig) writeFileSync(join(root, 'docs/taste.md'), readFileSync(new URL('../../templates/taste.md', import.meta.url), 'utf8'));
  writeFileSync(join(root, 'docs/input.md'), '# Input\n'); writeFileSync(join(root, 'outside.txt'), 'Outside\n');
  if (initialConfig) writeProjectConfig(root, { testRoots: [], sourceRoots: [], ...(docsWork === undefined ? {} : { docsWork }) });
  writeFileSync(join(root, 'docs/writing.md'), defaultWritingSource);
  git(root, 'add', "."); git(root, 'commit', '-qm', 'fixture');
  return root;
}
export const custom = { sharedPaths: ['docs/README.md', 'docs/concepts.md', 'docs/writing.md'] };

const templates = new Map<string, string>();
export function fixture(docsWork?: unknown, initialConfig = true): string {
  const key = JSON.stringify({ docsWork, initialConfig });
  let template = templates.get(key);
  if (template === undefined) { template = buildFixture(docsWork, initialConfig); templates.set(key, template); }
  const root = mkdtempSync(join(tmpdir(), 'concord-docs-work-consumer-'));
  cpSync(template, root, { recursive: true });
  return root;
}
after(() => { for (const path of templates.values()) rmSync(path, { recursive: true, force: true }); });
