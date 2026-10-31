import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { openTerminal } from '../../scripts/terminal-process.js';
import { installedConcordCli } from '../support/support.js';
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
