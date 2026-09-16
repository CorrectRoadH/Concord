import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { Root, RootContent } from 'mdast';
import { prepareDocumentPackageMigration } from '../scripts/document-package-migration.js';

// @use-case docs/feature/document-packages/use-case/migrate-document-discovery.md
test('moving Research retains actual destinations for balanced parentheses, escapes and definitions', t => {
  const root = mkdtempSync(join(tmpdir(), 'concord-package-links-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'docs/research'), { recursive: true });
  writeFileSync(join(root, 'concord.config.ts'), "export default {format:'concord.project/v1',projectId:'links',testRoots:[],runner:{kind:'node-test',sourceFiles:[],timeoutMs:60000}};\n");
  const body = '# Topic\n\n[balanced](asset(a).png)\n\n[escaped](asset\\(a\\).png)\n\n[same.png](same.png)\n\n[ref]: asset(a).png "title"\n\n`[code](same.png)`\n';
  writeFileSync(join(root, 'docs/research/topic.md'), '---\nformat: concord.document/v1\nid: topic\ntitle: Topic\ncreatedAt: today\nkind: research\nsources: []\n---\n'+body);
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture']);
  const result = prepareDocumentPackageMigration({ root, generatedAt: '2026-09-15T00:00:00Z' });
  const after = result.changes.find(change => change.path === 'docs/research/topic/README.md')!.after!.toString('utf8');
  const destinations: string[] = [];
  const visit = (node: Root | RootContent): void => {
    if (node.type === 'link' || node.type === 'definition') destinations.push(node.url);
    if ('children' in node) node.children.forEach(visit);
  };
  visit(fromMarkdown(after));
  assert.equal(after.slice(after.indexOf('# Topic')), '# Topic\n\n[balanced](../asset(a).png)\n\n[escaped](../asset(a).png)\n\n[same.png](../same.png)\n\n[ref]: ../asset(a).png "title"\n\n`[code](same.png)`\n');
  assert.deepEqual(destinations, ['../asset(a).png', '../asset(a).png', '../same.png', '../asset(a).png']);
  assert.match(after, /\[same\.png\]\(\.\.\/same\.png\)/);
  assert.match(after, /`\[code\]\(same\.png\)`/);
});
