import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Schema } from 'effect';
import { run, withInstaller } from './install-script-fixture.ts';
import { publishArchiveCandidate } from './archive-installer-assets.ts';

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md#verify
export const verifyArchiveInstaller = (archiveRoot: string, archive?: string) => withInstaller(f => {
  const metadata = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ version: Schema.String })))(readFileSync(join(archiveRoot, 'app/package.json'), 'utf8'));
  // Development artifacts retain their exact version bytes; the download fixture needs a release-shaped tag.
  const installationVersion = metadata.version === 'dev' ? '0.9.0' : metadata.version;
  publishArchiveCandidate(f, installationVersion, archiveRoot, archive);
  f.succeed(installationVersion);
  const installed = join(f.root, installationVersion);
  assert.equal(readlinkSync(f.bin), join(installed, 'bin/concord'));
  const cli = f.cli(['--version']); assert.equal(cli.status, 0, cli.stdout + cli.stderr); assert.equal(cli.stdout.trim(), `concord v${metadata.version}`);
  const help = f.cli(['--help']); assert.equal(help.status, 0, help.stdout + help.stderr); assert.match(help.stdout, /concord/iu);
  assert.equal(existsSync(join(installed, 'app/node_modules/@playwright')), false);
  assert.equal(existsSync(join(installed, 'app/node_modules/effect/package.json')), true);
  const workspace = join(f.scratch, 'workspace'); mkdirSync(workspace);
  const git = run(['git', 'init', workspace], f.env, f.scratch); assert.equal(git.status, 0, git.stderr);
  const initialized = run([f.bin, '--root', workspace, '--json', 'init', '--docs-only', '--yes'], f.env, workspace);
  assert.equal(initialized.status, 0, initialized.stdout + initialized.stderr);
  assert.equal(existsSync(join(workspace, 'concord.config.ts')), true);
  const checked = run([f.bin, '--root', workspace, '--server=command', '--json', 'check'], f.env, workspace);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  const Check = Schema.fromJsonString(Schema.Struct({ ok: Schema.Boolean, complete: Schema.Boolean }));
  assert.deepEqual(Schema.decodeUnknownSync(Check)(checked.stdout), { ok: true, complete: true });
  assert.deepEqual(readdirSync(join(installed, '.in-use')), []);
  assert.equal(existsSync(join(f.home, '.bashrc')), false); assert.equal(existsSync(join(f.home, '.zshrc')), false);
});
