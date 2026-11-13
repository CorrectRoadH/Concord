import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { linkWorktreeDependencies } from '../../src/base/git/index.ts';
import { gitCommand } from '../support/fix-consumer.ts';
import { tmpdir } from '../support/temporary.ts';

// @use-case docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md#close-fixed
// @issue docs/issues/verification-dependencies.md
test('verification links all ignored dependency directories with historical parents only', () => {
  const root = mkdtempSync(join(tmpdir(), 'verification-dependencies-'));
  const source = join(root, 'source'), target = join(root, 'target');
  try {
    mkdirSync(source); mkdirSync(target); gitCommand(source, 'init', '-q');
    writeFileSync(join(source, '.gitignore'), 'node_modules/\n.venv/\nbuild/\n.cache/\n');
    const included = ['node_modules', 'packages/member/node_modules', 'e2e/eval/node_modules', 'python/.venv'];
    for (const path of [...included, 'new-package/node_modules', 'build', '.cache', 'node_modules/nested/node_modules']) mkdirSync(join(source, path), { recursive: true });
    for (const path of ['packages/member', 'e2e/eval', 'python']) mkdirSync(join(target, path), { recursive: true });
    mkdirSync(join(source, 'tracked/node_modules'), { recursive: true });
    writeFileSync(join(source, 'tracked/node_modules/file'), 'tracked');
    gitCommand(source, 'add', '-f', 'tracked/node_modules/file');
    mkdirSync(join(target, 'tracked'), { recursive: true });
    linkWorktreeDependencies(source, target);
    for (const path of included) assert.equal(readlinkSync(join(target, path)), join(source, path));
    for (const path of ['new-package', 'build', '.cache', 'tracked/node_modules']) assert.equal(existsSync(join(target, path)), false, path);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
