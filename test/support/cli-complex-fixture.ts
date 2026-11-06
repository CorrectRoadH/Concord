import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { genericPrivateDirectorySync } from '../../src/base/publication/index.ts';
import { runCli } from './cli.ts';
import { tmpdir } from './temporary.ts';

/** Keep the offline gh protocol at the external executable boundary. */
export function ghFixture(createConsumer: () => string): { scratch: string; consumer: string; env: NodeJS.ProcessEnv } {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-gh-packed-'));
  try {
    const consumer = join(scratch, 'consumer');
    const template = createConsumer();
    try { cpSync(template, consumer, { recursive: true }); } finally { rmSync(template, { recursive: true, force: true }); }
    const fakeBin = join(scratch, 'bin');
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, 'gh'), `#!${process.execPath}\nconst args=process.argv.slice(2);if(args[0]==='--version'){console.log('gh version 2.98.0 (fixture)');return;}if(args[1]==='--help'){console.log('--hostname --method --include');return;}const endpoint=args.at(-1);const value=endpoint==='repos/acme/widgets'?{id:42,full_name:'acme/widgets'}:[];process.stdout.write('HTTP/2 200 OK\\r\\ncontent-type: application/json\\r\\n\\r\\n'+JSON.stringify(value));`, { mode: 0o755 });
    return { scratch, consumer, env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}`, GH_TOKEN: 'fixture-token' } };
  } catch (cause) { rmSync(scratch, { recursive: true, force: true }); throw cause; }
}

/** A captured query may own a real service; confirm shutdown before deleting its tree. */
export async function stopCliWorkspace(root: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!existsSync(root)) return;
  const record = join(genericPrivateDirectorySync(root, env), 'server/current.json');
  if (!existsSync(record)) return;
  const result = await runCli({ argv: ['--root', root, '--json', 'server', 'stop'], cwd: process.cwd(), env, signal: AbortSignal.timeout(20_000) });
  assert.equal(result.exitCode, 0, `Fixture service cleanup failed for ${root}: ${result.stdout}${result.stderr}`);
  assert.equal(existsSync(record), false, `server stop must confirm cleanup before removing ${root}`);
}
