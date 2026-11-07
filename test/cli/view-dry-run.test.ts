import assert from 'node:assert/strict';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { initialize } from '../support/operations.ts';
import { LocalRepository } from '../support/repository.ts';
import { fixture } from '../support/view-http-fixture.ts';
import { runCli } from '../support/cli.ts';

// @feature docs/feature/web-workbench/cli.md
test('view CLI propagates or rejects shared dry-run without cache or repository writes', async () => {
  const { root } = fixture();
  try {
    const input = join(root, 'action.json');
    const preview = await runCli({ argv: ['--root', root, '--dry-run', '--json', 'init', '--docs-only'], cwd: process.cwd(), env: process.env, stdin: '', signal: AbortSignal.timeout(10_000) });
    assert.equal(preview.exitCode, 0, preview.stderr);
    assert.equal((JSON.parse(preview.stdout) as { dryRun: boolean }).dryRun, true);
    assert.equal(existsSync(join(root, 'concord.config.ts')), false);
    assert.equal(existsSync(join(root, '.git/concord')), false);

    const rejected = await runCli({ argv: ['--root', root, '--dry-run', '--json', 'view', '--port', '0'], cwd: process.cwd(), env: process.env, stdin: '', signal: AbortSignal.timeout(10_000) });
    assert.equal(rejected.exitCode, 1);
    assert.equal((JSON.parse(rejected.stderr) as { error: string }).error, 'InvalidOption');

    let repo = (await LocalRepository.open(root, { initialize: true }));
    (await initialize(repo, false, { testRoots: [] }));
    repo.close();
    writeFileSync(input, JSON.stringify({ action: 'document.create', kind: 'feature', id: 'dry-preview', title: 'Dry preview' }));
    const actionPreview = await runCli({ argv: ['--root', root, '--dry-run', '--json', 'action', '--input', input], cwd: process.cwd(), env: process.env, stdin: '', signal: AbortSignal.timeout(10_000) });
    assert.equal(actionPreview.exitCode, 0, actionPreview.stderr);
    assert.equal((JSON.parse(actionPreview.stdout) as { dryRun: boolean }).dryRun, true);
    assert.equal(existsSync(join(root, 'docs/feature/dry-preview')), false);
    assert.equal(existsSync(join(root, '.git/concord/cache.hawdb')), false);
    writeFileSync(input, JSON.stringify({ action: 'recover' }));
    const unsafePreview = await runCli({ argv: ['--root', root, '--dry-run', '--json', 'action', '--input', input], cwd: process.cwd(), env: process.env, stdin: '', signal: AbortSignal.timeout(10_000) });
    assert.equal(unsafePreview.exitCode, 1);
    assert.equal((JSON.parse(unsafePreview.stderr) as { error: string }).error, 'InvalidOption');
    const cache = join(root, '.git/concord/cache.hawdb');
    assert.equal(existsSync(cache), false);
    const workspace = await runCli({ argv: ['--root', root, '--dry-run', '--json', 'workspace', 'show'], cwd: process.cwd(), env: process.env, stdin: '', signal: AbortSignal.timeout(10_000) });
    assert.equal(workspace.exitCode, 0, workspace.stderr);
    assert.equal((JSON.parse(workspace.stdout) as { cache: { status: string } }).cache.status, 'off');
    assert.equal(existsSync(cache), false);

  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
