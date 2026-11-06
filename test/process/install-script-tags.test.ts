import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { withInstaller } from '../support/install-script-fixture.ts';

// @use-case docs/feature/cross-platform-release/use-case/install-with-script.md
test('latest and explicit versions install releases using the supported concord-v tag prefix', { timeout: 55_000 }, () => withInstaller(f => {
  f.publish('0.9.3');
  renameSync(join(f.release, 'download/v0.9.3'), join(f.release, 'download/concord-v0.9.3'));
  mkdirSync(join(f.release, 'tag'));
  writeFileSync(join(f.release, 'tag/concord-v0.9.3'), '');
  f.succeed(undefined, { INSTALL_FIXTURE_LATEST_TAG: 'concord-v0.9.3' });
  assert.equal(f.cli(['--version']).stdout.trim(), 'concord v0.9.3');
  f.succeed('0.9.3');
  assert.equal(f.cli(['--version']).stdout.trim(), 'concord v0.9.3');
  const requests = readFileSync(join(f.release, 'requests'), 'utf8');
  assert.match(requests, /download\/concord-v0\.9\.3\/SHA256SUMS/u);
  assert.match(requests, /download\/concord-v0\.9\.3\/concord-0\.9\.3-(linux-x64|darwin-arm64)\.tar\.gz/u);
}));
