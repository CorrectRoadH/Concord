import assert from 'node:assert/strict';
import test from 'node:test';
import { compareModVersions, modManifest } from '../../src/model/herdr-mod/index.js';

// @use-case docs/feature/herdr-mod/use-case/install-from-herdr.md
test('mod minimum follows its package and CLI compatibility uses SemVer precedence', () => {
  assert.deepEqual(modManifest('2.3.4'), { place: 'right', size: 760, minimumConcordVersion: '2.3.4', overlay: { width: 760, height: 220 } });
  for (const [current, minimum, expected] of [
    ['1.9.0', '1.10.0', -1], ['2.0.0', '1.10.0', 1], ['1.2.3', '1.2.3', 0],
    ['1.2.3-alpha.2', '1.2.3-alpha.10', -1], ['1.2.3-rc.1', '1.2.3', -1],
    ['1.2.3+build.1', '1.2.3+build.2', 0], ['dev', '1.2.3', 0],
  ] as const) assert.equal(compareModVersions(current, minimum), expected);
  assert.throws(() => modManifest('not-a-version'));
});
