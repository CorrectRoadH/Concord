import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, Schema } from 'effect';
import { distributionRoot, installedPackageRoot } from './installed-package.js';

export const installer = join(distributionRoot, 'install.sh');
const Manifest = Schema.fromJsonString(Schema.Struct({ bin: Schema.Struct({ concord: Schema.String }) }));
export const command = (name: string): string => {
  const result = spawnSync('which', [name], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
export const run = (args: string[], env: NodeJS.ProcessEnv, cwd: string) => spawnSync(args[0]!, args.slice(1), { cwd, env, encoding: 'utf8', timeout: 45_000 });

const createFixture = (scratch: string) => {
  const home = join(scratch, 'home with spaces'), release = join(scratch, 'release'), adapters = join(scratch, 'adapters');
  mkdirSync(home); mkdirSync(adapters); mkdirSync(release);
  const manifest = Schema.decodeUnknownSync(Manifest)(readFileSync(join(installedPackageRoot(), 'package.json'), 'utf8'));
  const store = spawnSync('pnpm', ['store', 'path'], { encoding: 'utf8' });
  assert.equal(store.status, 0, store.stderr);
  symlinkSync(command('node'), join(adapters, 'node'));
  const adapter = fileURLToPath(new URL('./install-script-download.ts', import.meta.url));
  writeFileSync(join(adapters, 'curl'), `#!${process.execPath}\n${readFileSync(adapter, 'utf8').split('\n').slice(1).join('\n')}`);
  chmodSync(join(adapters, 'curl'), 0o755);
  const env = { ...process.env, HOME: home, PATH: `${adapters}:${process.env.PATH}`, NODE_OPTIONS: '', INSTALL_FIXTURE_RELEASE: release, INSTALL_FIXTURE_CURL: command('curl'), npm_config_offline: 'true', npm_config_store_dir: store.stdout.trim(), COREPACK_HOME: process.env.COREPACK_HOME ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'node/corepack'), COREPACK_ENABLE_NETWORK: '0', CI: 'true' };
  const source = join(scratch, 'candidate'); mkdirSync(source);
  for (const path of ['dist', 'docs', 'templates', 'skills', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', ...readdirSync(installedPackageRoot()).filter(name => /^README(?:\..+)?\.md$/u.test(name))]) cpSync(join(installedPackageRoot(), path), join(source, path), { recursive: true });
  const archives = new Map<string, Buffer>();
  const publish = (version: string, options: { corrupt?: boolean; brokenLock?: boolean; missing?: boolean } = {}) => {
    const target = join(release, 'download', `v${version}`); mkdirSync(target, { recursive: true });
    const archive = `concord-sdlc-${version}.tgz`, archivePath = join(target, archive);
    const existing = archives.get(version);
    if (existing && !options.brokenLock) writeFileSync(archivePath, existing);
    else {
      const metadata = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(readFileSync(join(source, 'package.json'), 'utf8'));
      writeFileSync(join(source, 'package.json'), JSON.stringify({ ...metadata, version }));
      const lock = readFileSync(join(installedPackageRoot(), 'pnpm-lock.yaml'), 'utf8');
      writeFileSync(join(source, 'pnpm-lock.yaml'), options.brokenLock ? lock.replace('4.0.0-rc.112', '0.0.0-install-script-missing') : lock);
      // Use the exact release packer, including its manifest/lock byte checks.
      const packed = run(['node', '--import', 'tsx', join(distributionRoot, 'scripts/release-package.ts'), target, source], env, distributionRoot);
      assert.equal(packed.status, 0, packed.stdout + packed.stderr);
      if (!options.brokenLock) archives.set(version, readFileSync(archivePath));
    }
    const hash = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
    writeFileSync(join(target, 'SHA256SUMS'), `${options.corrupt ? '0'.repeat(64) : hash}  release/${archive}\n${createHash('sha256').update(readFileSync(installer)).digest('hex')}  release/install.sh\n`);
    if (options.missing) rmSync(archivePath);
  };
  const install = (version?: string, extra: NodeJS.ProcessEnv = {}) => run(['sh', installer], { ...env, CONCORD_VERSION: version ?? '', ...extra }, scratch);
  const succeed = (version?: string, extra: NodeJS.ProcessEnv = {}) => {
    const result = install(version, extra); assert.equal(result.status, 0, result.stdout + result.stderr); return result;
  };
  const root = join(home, '.local/share/concord'), bin = join(home, '.local/bin/concord');
  const cli = (args: string[]) => run([bin, ...args], env, scratch);
  return { scratch, home, release, env, manifest, root, bin, publish, install, succeed, cli };
};

export const withInstaller = (body: (fixture: ReturnType<typeof createFixture>) => void): void => Effect.runSync(Effect.sync(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-install-script-'));
  try { body(createFixture(scratch)); }
  finally { rmSync(scratch, { recursive: true, force: true }); }
}));
