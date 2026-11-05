import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { installedConcordCli } from '../support/support.js';
import { tmpdir } from '../support/temporary.js';

// @feature docs/feature/local-sdlc/README.md
test('show enumerates sorted package pages and their current headings before relationships', () => {
  const root = mkdtempSync(join(tmpdir(), 'concord-show-pages-'));
  const cli = installedConcordCli();
  const write = (path: string, body: string) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), body); };
  const call = (selector: string, json = true) => {
    const reply = spawnSync(process.execPath, [cli, '--root', root, '--fresh', ...(json ? ['--json'] : []), 'show', selector], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(reply.status, 0, reply.stdout + reply.stderr); return reply.stdout;
  };
  try {
    execFileSync('git', ['init', '-q', root]);
    const pages = [
      ['README.md', 'readme', 'Cart'], ['architecture.md', 'architecture', 'Mechanism'], ['cli.md', 'cli', 'Commands'],
      ['library.md', 'library', 'Library'], ['notes.md', 'unknown', 'Notes'], ['use-case/add.md', 'use-case', 'Add item'],
    ];
    for (const [file, , name] of pages) write(`docs/feature/cart/${file}`, `# ${name}\n`);
    const result = JSON.parse(call('cart')) as { pages: { path: string; kind: string; name: string }[] };
    assert.deepEqual(result.pages, pages.map(([file, kind, name]) => ({ path: `docs/feature/cart/${file}`, kind, name })));
    write('docs/feature/cart/notes.md', '# Current notes\n');
    assert.equal((JSON.parse(call('cart')) as typeof result).pages.find(page => page.kind === 'unknown')?.name, 'Current notes');
    const human = call('cart', false); assert.ok(human.indexOf('Pages:') < human.indexOf('incoming:'));
    for (const kind of ['engineering', 'roadmap']) {
      write(`docs/${kind}/sample/README.md`, '# Sample\n'); write(`docs/${kind}/sample/cli.md`, '# Calls\n');
      assert.equal((JSON.parse(call(`docs/${kind}/sample/README.md`)) as typeof result).pages.length, 2);
    }
    write('memory/lesson.md', '# Lesson\n');
    assert.equal('pages' in (JSON.parse(call('memory/lesson.md')) as object), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
