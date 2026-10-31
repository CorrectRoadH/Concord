import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Effect } from 'effect';
import { openTerminal } from '../../scripts/terminal-process.js';
import { installedConcordCli, pollUntil } from '../support/support.js';
import { command, fixture, record, stop } from '../support/workspace-server-fixture.js';

// @use-case docs/feature/herdr-panel/use-case/open-side-panel.md
// @issue docs/issues/workspace-server-unimplemented.md
test('an installed panel uses a real terminal and displays pushed source generations', { timeout: 30_000 }, async () => {
  const root = fixture();
  writeFileSync(join(root, 'concord.config.ts'), 'export default {};\n');
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const panel = yield* openTerminal([process.execPath, installedConcordCli(), '--root', root, 'panel'], root);
      yield* panel.waitFor('First generation.');
      const token = record(root).token;
      const offset = panel.text().length;
      writeFileSync(join(root, 'docs/feature/reader/README.md'), '# Reader\n\nPushed generation.\n');
      yield* panel.waitFor('Pushed generation.', offset);
      assert.equal(record(root).token, token);
      assert.equal((yield* Effect.promise(() => command(root, ['list', 'feature']))).status, 0);
      yield* panel.send('q');
    })));
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/herdr-panel/use-case/open-side-panel.md
// @issue docs/issues/workspace-server-unimplemented.md
test('an uninitialized worktree exits with an init hint before starting the panel service', async () => {
  const root = fixture();
  try {
    const result = await command(root, ['panel']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /concord init/u);
    assert.equal((await command(root, ['server', 'status'])).stdout.includes('absent'), true);
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});

// @use-case docs/feature/herdr-panel/use-case/open-side-panel.md
// @issue docs/issues/workspace-server-unimplemented.md
test('C24 two installed panels and view share one starter, and C20 edits reach both terminal and Web generations', { timeout: 30_000 }, async () => {
  const root = fixture();
  writeFileSync(join(root, 'concord.config.ts'), "export default { sourceRoots: ['src'] };\n");
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/reader.ts'), '// @concord-file\n// @concord-implements docs/feature/reader/README.md\nexport const current = 0;\n');
  writeFileSync(join(root, 'docs/feature/reader/architecture.md'), '# Reader architecture\n\nInitial.\n');
  mkdirSync(join(root, 'docs/feature/reader/use-case'));
  writeFileSync(join(root, 'docs/feature/reader/use-case/read.md'), '# Read\n\nInitial.\n');
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const entry = installedConcordCli();
      const first = yield* openTerminal([process.execPath, entry, '--root', root, 'panel'], root);
      const second = yield* openTerminal([process.execPath, entry, '--root', root, 'panel'], root);
      const web = yield* openTerminal([process.execPath, entry, '--root', root, '--json', 'view', '--host', '127.0.0.1', '--port', '0'], root);
      yield* Effect.all([first.waitFor('First generation.'), second.waitFor('First generation.'), web.waitFor('"operation":"view"')], { concurrency: 'unbounded' });
      const info = JSON.parse(web.text().split('\n').find(line => line.startsWith('{"operation":"view"'))!) as { address: string };
      const token = record(root).token;
      const beforeFirst = first.text().length, beforeSecond = second.text().length;
      writeFileSync(join(root, 'docs/feature/reader/README.md'), '# Reader\n\nFINAL_GENERATION.\n');
      writeFileSync(join(root, 'docs/feature/reader/architecture.md'), '# Reader architecture\n\nFinal architecture.\n');
      writeFileSync(join(root, 'docs/feature/reader/use-case/read.md'), '# Read\n\nFinal behavior.\n');
      writeFileSync(join(root, 'src/reader.ts'), '// @concord-file\n// @concord-implements docs/feature/reader/README.md\nexport const current = 1;\n');
      yield* Effect.all([first.waitFor('FINAL_GENERATION.', beforeFirst), second.waitFor('FINAL_GENERATION.', beforeSecond)], { concurrency: 'unbounded' });
      yield* Effect.promise(() => pollUntil(async () => {
        const response = await fetch(new URL('api/workspace', info.address), { headers: { Connection: 'close' } });
        if (!response.ok) return undefined;
        const value = await response.json() as { value: { projection: { consistent: boolean }; snapshot: { pages: { path: string; digest: string }[]; documents: { path: string; digest: string }[]; sources: { path: string; digest: string }[] } } };
        const hash = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
        return value.value.projection.consistent
          && value.value.snapshot.pages.some(page => page.path.endsWith('/architecture.md') && page.digest === hash('# Reader architecture\n\nFinal architecture.\n'))
          && value.value.snapshot.documents.some(page => page.path.endsWith('/read.md') && page.digest === hash('# Read\n\nFinal behavior.\n'))
          && value.value.snapshot.sources.some(source => source.path === 'src/reader.ts' && source.digest === hash('// @concord-file\n// @concord-implements docs/feature/reader/README.md\nexport const current = 1;\n')) ? value : undefined;
      }, { description: 'Web accepts the same completed source generation as both panels', timeoutMs: 10_000 }));
      assert.equal(record(root).token, token);
      yield* Effect.all([first.send('q'), second.send('q'), web.send('\u0003')], { concurrency: 'unbounded' });
    })));
  } finally { await stop(root); rmSync(root, { recursive: true, force: true }); }
});
