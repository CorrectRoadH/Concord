import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setMarkdown } from '../../src/app/index.ts';
import { parseDocumentRecord } from '../../src/domain/documents/index.ts';
import { digest, fromMarkdown, renderDocument } from '../../src/model/index.ts';
import { createConsumer } from './consumer.ts';
import { LocalRepository } from './repository.ts';
import { addPage, createDocument } from './operations.ts';
import { writeProjectConfig } from './support.ts';
import { makeRuntimeEnvironment as makeParserRuntime } from '../../src/base/environment/index.ts';
const parserRuntime = makeParserRuntime(process.cwd(), process.env);


export async function authoringConsumer(): Promise<string> {
  const root = (await createConsumer());
  writeProjectConfig(root, { testRoots: ['test'], sourceRoots: ['src'], runner: { kind: 'command', argv: [process.execPath, 'test', '--no-env-file', '--config=/dev/null', '--timeout=15000', '{file}'], timeoutMs: 15000, sourceFiles: [] } });
  const repo = (await LocalRepository.open(root));
  try {
    (await createDocument(repo,'engineering',{id:'build',title:'Build workflow'}));
    const engineeringPath=join(root,'docs/engineering/build/README.md');
    const engineeringSource = readFileSync(engineeringPath, 'utf8');
    (await setMarkdown(repo, 'docs/engineering/build/README.md', `${engineeringSource}\n\`\`\`mermaid\nflowchart LR\n  Source --> Result\n\`\`\`\n`, digest(engineeringSource)));
    (await addPage(repo,'engineering','build','architecture'));
    const architecturePath = 'docs/engineering/build/architecture.md';
    (await setMarkdown(repo, architecturePath, '# Architecture\n\n## Source\n', digest(readFileSync(join(root, architecturePath), 'utf8'))));
    (await createDocument(repo,'roadmap',{id:'future',title:'Future direction',pages:['architecture']}));
    (await createDocument(repo,'design',{id:'options',title:'Design options'}));
  } finally { repo.close(); }
  mkdirSync(join(root,'src'));
  writeFileSync(join(root,'src/demo.ts'),'// @concord-code\n// @concord-implements docs/engineering/build/architecture.md#source\nexport function demo() { return 1; }\n');
  return root;
}

/** Replay the preceding path's committed document operations through public APIs. */
export async function replayAuthoringState(root: string): Promise<void> {
  const repo = (await LocalRepository.open(root));
  const editParagraph = async (path: string, text: string) => {
    const before = readFileSync(join(root, path), 'utf8');
    const record = parseDocumentRecord(path, before, parserRuntime);
    const body = record?.body ?? before;
    const paragraph = fromMarkdown(body).children.find(node => node.type === 'paragraph');
    assert.ok(paragraph?.position?.start.offset !== undefined && paragraph.position.end.offset !== undefined);
    const after = body.slice(0, paragraph.position.start.offset) + text + body.slice(paragraph.position.end.offset);
    (await setMarkdown(repo, path, record === undefined ? after : renderDocument(record.metadata, after), digest(before)));
  };
  try {
    (await createDocument(repo, 'feature', { id: 'browser-feature', title: 'Browser authoring', pages: ['architecture', 'library'], body: '# Browser authoring\n\nOriginal paragraph.\n' }));
    (await createDocument(repo, 'feature', { id: 'alternate-feature', title: 'Alternate Feature' }));
    const feature = 'docs/feature/browser-feature/README.md';
    for (const text of ['Browser edited paragraph.', 'External editor wins.', 'External editor wins. Flushed from Feature.', 'Refreshed Git content. Flushed from Feature.']) (await editParagraph(feature, text));
    (await createDocument(repo, 'use-case', { id: 'browser-flow', title: 'Nested browser flow', feature: 'browser-feature' }));
    for (const text of ['Saved Use Case body.', 'Saved on drawer close.']) (await editParagraph('docs/feature/browser-feature/use-case/browser-flow.md', text));
    (await editParagraph('docs/feature/browser-feature/architecture.md', 'Architecture from browser.'));
  } finally { repo.close(); }
}
