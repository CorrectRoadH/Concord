import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';

export const installer = fileURLToPath(new URL('../../install.sh', import.meta.url));
export const command = (name: string): string => {
  const result = spawnSync('which', [name], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
export const run = (args: string[], env: NodeJS.ProcessEnv, cwd: string) => spawnSync(args[0]!, args.slice(1), { cwd, env, encoding: 'utf8', timeout: 45_000 });

const createFixture = (scratch: string) => {
  const home = join(scratch, 'home with spaces'), release = join(scratch, 'release'), adapters = join(scratch, 'adapters');
  mkdirSync(home); mkdirSync(adapters); mkdirSync(release);
  const adapter = fileURLToPath(new URL('./install-script-download.ts', import.meta.url));
  writeFileSync(join(adapters, 'curl'), `#!${process.execPath}\n${readFileSync(adapter, 'utf8').split('\n').slice(1).join('\n')}`);
  chmodSync(join(adapters, 'curl'), 0o755);
  // A forbidden PATH runtime proves that the installer does not use Node or pnpm.
  for (const name of ['node', 'npm', 'pnpm', 'rg']) {
    writeFileSync(join(adapters, name), '#!/bin/sh\nexit 97\n'); chmodSync(join(adapters, name), 0o755);
  }
  const env = { ...process.env, HOME: home, PATH: `${adapters}:${process.env.PATH}`, NODE_OPTIONS: '', INSTALL_FIXTURE_RELEASE: release, INSTALL_FIXTURE_CURL: command('curl'), CI: 'true' };
  const source = join(scratch, 'candidate');
  mkdirSync(join(source, 'bin'), { recursive: true }); mkdirSync(join(source, 'runtime')); mkdirSync(join(source, 'app'));
  symlinkSync(command('sh'), join(source, 'runtime/node'));
  const publishArchive = (version: string, archiveRoot: string) => {
    const target = join(release, 'download', `v${version}`); mkdirSync(target, { recursive: true });
    const platform = process.platform === 'darwin' ? 'darwin-arm64' : 'linux-x64';
    const archive = `concord-${version}-${platform}.tar.gz`, archivePath = join(target, archive);
    const packed = run(['tar', '-czf', archivePath, '-C', archiveRoot, '.'], env, scratch);
    assert.equal(packed.status, 0, packed.stdout + packed.stderr);
    const hash = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
    writeFileSync(join(target, 'SHA256SUMS'), `${hash}  ${archive}\n`);
  };
  const archives = new Map<string, Buffer>();
  const publish = (version: string, options: { corrupt?: boolean; brokenArchive?: boolean; missing?: boolean; checksumRows?: string } = {}) => {
    const target = join(release, 'download', `v${version}`); mkdirSync(target, { recursive: true });
    const platform = process.platform === 'darwin' ? 'darwin-arm64' : 'linux-x64';
    const archive = `concord-${version}-${platform}.tar.gz`, archivePath = join(target, archive);
    const existing = archives.get(version);
    if (existing && !options.brokenArchive) writeFileSync(archivePath, existing);
    else {
      // Minimal executable archive tests only the installation protocol. Actual
      // product behaviour is separately revalidated with the parent's real archive.
      writeFileSync(join(source, 'bin/concord'), `#!/bin/sh\ncase "$1" in --version) printf 'concord v${version}\\n';; --help) printf 'concord help\\n';; *) exit 2;; esac\n`);
      chmodSync(join(source, 'bin/concord'), 0o755);
      writeFileSync(join(source, 'app/package.json'), JSON.stringify({ name: 'concord-sdlc', version }));
      const packed = run(['tar', '-czhf', archivePath, '-C', source, '.'], env, scratch);
      assert.equal(packed.status, 0, packed.stdout + packed.stderr);
      if (options.brokenArchive) writeFileSync(archivePath, 'not an archive');
      else archives.set(version, readFileSync(archivePath));
    }
    const hash = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
    writeFileSync(join(target, 'SHA256SUMS'), options.checksumRows ?? `${options.corrupt ? '0'.repeat(64) : hash}  release/${archive}\n${createHash('sha256').update(readFileSync(installer)).digest('hex')}  release/install.sh\n`);
    if (options.missing) rmSync(archivePath);
  };
  const install = (version?: string, extra: NodeJS.ProcessEnv = {}) => run(['sh', installer], { ...env, CONCORD_VERSION: version ?? '', ...extra }, scratch);
  const succeed = (version?: string, extra: NodeJS.ProcessEnv = {}) => {
    const result = install(version, extra); assert.equal(result.status, 0, result.stdout + result.stderr); return result;
  };
  const root = join(home, '.local/share/concord'), bin = join(home, '.local/bin/concord');
  const cli = (args: string[]) => run([bin, ...args], env, scratch);
  return { scratch, home, release, env, adapters, manifest: { bin: { concord: 'bin/concord' } }, root, bin, publish, publishArchive, install, succeed, cli };
};

export const withInstaller = (body: (fixture: ReturnType<typeof createFixture>) => void): void => Effect.runSync(Effect.sync(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-install-script-'));
  try { body(createFixture(scratch)); }
  finally { rmSync(scratch, { recursive: true, force: true }); }
}));

export const withInstallerAsync = async (body: (fixture: ReturnType<typeof createFixture>) => Promise<void>): Promise<void> => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-install-script-'));
  try { await body(createFixture(scratch)); }
  finally { rmSync(scratch, { recursive: true, force: true }); }
};
