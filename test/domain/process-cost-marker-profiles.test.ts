import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CodeDeclarationSchema } from '../../src/model/index.ts';
import { Schema } from 'effect';
import { query } from '../support/application-fixture.ts';
import { createConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository } from '../support/repository.ts';
import { server, source, target, write } from '../support/lsp-analysis-source-fixture.ts';
import { readProjectConfig, writeProjectConfig } from '../support/support.ts';

const codeList = Schema.Struct({ codes: Schema.Array(CodeDeclarationSchema) });
const projectCheck = Schema.Struct({ ok: Schema.Boolean });

// @use-case docs/feature/local-sdlc/use-case/analyze-other-languages.md
// CASES lsp-integration C1, C2, C14, C18.
test('Python Go Rust and Java marker profiles rebuild relations without launching a server', async () => {
  const root = (await createConsumer());
  try {
    writeProjectConfig(root, { testRoots: ['test'], sourceRoots: ['src'] });
    const repository = (await LocalRepository.open(root));
    try {
      (await createDocument(repository, 'feature', { id: 'sample', title: 'Sample' }));
      (await createDocument(repository, 'use-case', { id: 'sample', feature: 'sample', title: 'Sample' }));
    } finally { repository.close(); }
    write(root, 'src/sample.py', source);
    write(root, 'test/sample.py', `# @use-case ${target}\n# @name native-sample\ndef test_sample():\n    helper()\n`);
    write(root, 'test/helper.py', 'def helper():\n    implementation()\n');
    // The configured executable is deliberately absent; source queries cannot launch it.
    write(root, 'server.mjs', '// Static implementation identity, never executed.\n');
    const profiles = [['python', '.py', '#'], ['go', '.go', '//'], ['rust', '.rs', '//'], ['java', '.java', '//']] as const;
    writeProjectConfig(root, { ...(await readProjectConfig(root)), languageServers: profiles.map(([languageId, extension, prefix]) => ({ ...server(), id: languageId, languageId, extensions: [extension], argv: ['concord-server-that-must-not-start'], profile: { ...server().profile, commentPrefixes: [prefix] } })) });
    for (const [, extension, prefix] of profiles) write(root, `src/markers${extension}`, `${prefix} @concord-file\n${prefix} @concord-implements ${target}\n${prefix} @concord-code\n${prefix} @concord-implements ${target}\nfunction body\n${prefix} @concord-begin\n${prefix} @concord-implements ${target}\nstatements\n${prefix} @concord-end\n`);
    write(root, 'test/labels.py', '@pytest.mark.bad_target("docs/missing.md")\ndef no_concord_marker():\n    pass\n');
    const before = (await query(root, { name: 'code.list', input: {} }, codeList)).codes;
    assert.equal(before.filter(code => code.file.includes('markers')).length, 12);
    assert.equal((await query(root, { name: 'check', input: {} }, projectCheck)).ok, true);
    const text = readFileSync(join(root, 'src/markers.go'), 'utf8');
    write(root, 'src/markers.go', `\n\n${text}`);
    assert.deepEqual((await query(root, { name: 'code.list', input: {} }, codeList)).codes.map(code => code.id), before.map(code => code.id));
    write(root, 'src/markers.rs', text + '// @concord-end\n');
    assert.equal((await query(root, { name: 'check', input: {} }, projectCheck, 1)).ok, false);
    write(root, 'src/markers.rs', text);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
