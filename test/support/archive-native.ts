import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Schema } from 'effect';
import { hawdbTarget, installationResources } from '../../src/base/installation/index.ts';
import { prepareSourceConsumer, builtConcord } from './installed-package.ts';
import { tmpdir } from './temporary.ts';

// @use-case docs/feature/local-data-engine/use-case/use-unified-cache.md
export function verifyArchiveNative(packageRoot: string): void {
  const root = mkdtempSync(join(tmpdir(), 'concord-installed-native-'));
  try {
    writeFileSync(join(root, 'package.json'), '{"private":true}');
    prepareSourceConsumer(root, builtConcord(packageRoot), [], { private: true });
    const installed = join(root, 'node_modules/concord-sdlc');
    const consumer = root;
    const nativeBinary = join(installationResources(installed).native, hawdbTarget(), 'hawdb.node');
    const nativeBytes = readFileSync(nativeBinary);
    const native = spawnSync(process.execPath, [
      fileURLToPath(new URL('../../scripts/verify-installed-native.ts', import.meta.url)), installed,
    ], { cwd: consumer, encoding: 'utf8', timeout: 180_000, env: { ...process.env, NODE_OPTIONS: '' } });
    const nativeDiagnostics = `${native.stdout}\n${native.stderr}\n${String(native.error)}\nsignal=${native.signal}`;
    assert.deepEqual(readFileSync(nativeBinary), nativeBytes, `Installed native verification must restore the binary\n${nativeDiagnostics}`);
    assert.equal(native.status, 0, nativeDiagnostics);
    Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({
      engine: Schema.Literal('hawdb'), revision: Schema.String, abi: Schema.String, target: Schema.Literal(hawdbTarget()),
      compilerOnPath: Schema.Literal(false), helperOnPath: Schema.Literal(false),
      persistentHit: Schema.Literal(true), currentRecall: Schema.Literal(true), rebuilt: Schema.Literal(true),
    })))(native.stdout);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
