// @concord-file
// @concord-implements docs/feature/feedback/use-case/triage-feedback.md
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { setConfig, showConfig } from '../src/editing.js';
import { initialize, LocalRepository } from '../src/storage.js';

// @use-case docs/feature/feedback/use-case/triage-feedback.md
test('packed public CLI adds gh connection, checks scope, and executes shared feedback action offline', { skip: process.platform === 'win32' }, () => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-gh-packed-'));
  try {
    const pack = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], { cwd: resolve('.'), encoding: 'utf8', timeout: 60_000 })) as readonly { filename: string }[];
    const tool = join(scratch, 'tool');
    mkdirSync(tool);
    writeFileSync(join(tool, 'package.json'), JSON.stringify({ private: true }));
    execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', join(scratch, pack[0]!.filename)], { cwd: tool, encoding: 'utf8', timeout: 60_000 });
    const entry = join(tool, 'node_modules/concord-sdlc/dist/entry.js');
    const consumer = join(scratch, 'consumer');
    mkdirSync(consumer);
    execFileSync('git', ['init', '-q', consumer]);
    const initial = new LocalRepository(consumer, { initialize: true });
    try { initialize(initial); } finally { initial.close(); }
    const fakeBin = join(scratch, 'bin');
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, 'gh'), `#!${process.execPath}\nconst args=process.argv.slice(2);if(args[0]==='--version'){console.log('gh version 2.98.0 (fixture)');return;}if(args[1]==='--help'){console.log('--hostname --method --include');return;}const endpoint=args.at(-1);const value=endpoint==='repos/acme/widgets'?{id:42,full_name:'acme/widgets'}:[];process.stdout.write('HTTP/2 200 OK\\r\\ncontent-type: application/json\\r\\n\\r\\n'+JSON.stringify(value));`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}`, GH_TOKEN: 'fixture-token' };
    const cli = (...args: readonly string[]): unknown => JSON.parse(execFileSync(process.execPath, [entry, '--root', consumer, '--json', ...args], { cwd: consumer, env, encoding: 'utf8', timeout: 30_000 })) as unknown;
    cli('feedback', 'connection', 'add', '--id', 'gh-packed', '--provider', 'github', '--transport', 'gh', '--owner', 'acme', '--repo', 'widgets');
    assert.equal((cli('feedback', 'connection', 'check', 'gh-packed') as { target: string }).target, 'acme/widgets');
    const action = join(scratch, 'action.json');
    writeFileSync(action, JSON.stringify({ action: 'feedback.check', connection: 'gh-packed' }));
    assert.equal((cli('action', '--input', action) as { transport: string }).transport, 'gh');
    assert.equal((cli('feedback', 'sync', '--connection', 'gh-packed') as { fetched: number }).fetched, 0);
    const repo = new LocalRepository(consumer);
    try { const connection = showConfig(repo).config.feedbackConnections?.[0]; assert.equal(connection?.provider === 'github' ? connection.repositoryId : undefined, '42'); }
    finally { repo.close(); }
    const invalid = spawnSync(process.execPath, [entry, '--root', consumer, '--json', 'feedback', 'connection', 'add', '--id', 'bad-gh', '--provider', 'github', '--transport', 'gh', '--credential-env', 'BAD', '--owner', 'acme', '--repo', 'widgets'], { cwd: consumer, env, encoding: 'utf8', timeout: 30_000 });
    assert.notEqual(invalid.status, 0);
    assert.equal((JSON.parse(invalid.stderr.trim()) as { error: string }).error, 'InvalidOption');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
