import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setMarkdown } from '../../src/app/index.js';
import { parseDocumentRecord } from '../../src/domain/documents/index.js';
import { digest, fromMarkdown, renderDocument } from '../../src/model/index.js';
import { createConsumer } from './consumer.js';
import { LocalRepository } from './repository.js';
import { addPage, createDocument } from './operations.js';
import { writeProjectConfig } from './support.js';

export function authoringConsumer(): string {
  const root = createConsumer();
  writeProjectConfig(root, { testRoots: ['test'], sourceRoots: ['src'], runner: { kind: 'command', argv: [process.execPath, '--test', '{file}'], timeoutMs: 15000, sourceFiles: [] } });
  const repo = new LocalRepository(root);
  try {
    createDocument(repo,'engineering',{id:'build',title:'Build workflow'});
    const engineeringPath=join(root,'docs/engineering/build/README.md');
    const engineeringSource = readFileSync(engineeringPath, 'utf8');
    setMarkdown(repo, 'docs/engineering/build/README.md', `${engineeringSource}\n\`\`\`mermaid\nflowchart LR\n  Source --> Result\n\`\`\`\n`, digest(engineeringSource));
    addPage(repo,'engineering','build','architecture');
    const architecturePath = 'docs/engineering/build/architecture.md';
    setMarkdown(repo, architecturePath, '# Architecture\n\n## Source\n', digest(readFileSync(join(root, architecturePath), 'utf8')));
    createDocument(repo,'roadmap',{id:'future',title:'Future direction',pages:['architecture']});
    createDocument(repo,'design',{id:'options',title:'Design options'});
  } finally { repo.close(); }
  mkdirSync(join(root,'src'));
  writeFileSync(join(root,'src/demo.ts'),'// @concord-code\n// @concord-implements docs/engineering/build/architecture.md#source\nexport function demo() { return 1; }\n');
  return root;
}

/** Replay the preceding path's committed document operations through public APIs. */
export function replayAuthoringState(root: string): void {
  const repo = new LocalRepository(root);
  const editParagraph = (path: string, text: string) => {
    const before = readFileSync(join(root, path), 'utf8');
    const record = parseDocumentRecord(path, before);
    const body = record?.body ?? before;
    const paragraph = fromMarkdown(body).children.find(node => node.type === 'paragraph');
    assert.ok(paragraph?.position?.start.offset !== undefined && paragraph.position.end.offset !== undefined);
    const after = body.slice(0, paragraph.position.start.offset) + text + body.slice(paragraph.position.end.offset);
    setMarkdown(repo, path, record === undefined ? after : renderDocument(record.metadata, after), digest(before));
  };
  try {
    createDocument(repo, 'feature', { id: 'browser-feature', title: 'Browser authoring', pages: ['architecture', 'library'], body: '# Browser authoring\n\nOriginal paragraph.\n' });
    createDocument(repo, 'feature', { id: 'alternate-feature', title: 'Alternate Feature' });
    const feature = 'docs/feature/browser-feature/README.md';
    for (const text of ['Browser edited paragraph.', 'External editor wins.', 'External editor wins. Flushed from Feature.', 'Refreshed Git content. Flushed from Feature.']) editParagraph(feature, text);
    createDocument(repo, 'use-case', { id: 'browser-flow', title: 'Nested browser flow', feature: 'browser-feature' });
    for (const text of ['Saved Use Case body.', 'Saved on drawer close.']) editParagraph('docs/feature/browser-feature/use-case/browser-flow.md', text);
    editParagraph('docs/feature/browser-feature/architecture.md', 'Architecture from browser.');
  } finally { repo.close(); }
}
