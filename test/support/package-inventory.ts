import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Schema } from 'effect';
import { packageBin, type BuiltConcord } from './installed-package.ts';

/** Installation assertions retained for the packaging owner; ordinary source consumers do not invoke them. */
export function verifyPackageInventory(packed: BuiltConcord, packageRoot: string): void {
  assert.ok(packed);
  assert.ok(packed.files.some(file => file.path === 'pnpm-lock.yaml'), 'package must carry its runtime dependency lock');
  const manifest = Schema.Struct({ version: Schema.String, dependencies: Schema.Record(Schema.String, Schema.String), devDependencies: Schema.Record(Schema.String, Schema.String) });
  const published = Schema.decodeUnknownSync(Schema.fromJsonString(manifest))(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  for (const name of ['pnpm-lock.yaml', 'pnpm-workspace.yaml']) assert.equal(readFileSync(join(packageRoot, name), 'utf8'), readFileSync(new URL('../../' + name, import.meta.url), 'utf8'));
  assert.equal(execFileSync(process.execPath, [packageBin(packageRoot), '--version'], { encoding: 'utf8' }).trim(), `concord v${published.version}`);
  for (const path of ['skills/concord/SKILL.md', 'skills/concord/references/test.md', 'skills/concord/references/feedback.md', 'skills/concord/references/docs-from-scratch.md', 'skills/concord/references/docs-from-code.md', 'skills/concord/references/spec.md', 'skills/concord/references/implement.md', 'skills/concord/references/review.md', 'skills/concord/references/fix.md']) {
    assert.ok(packed.files.some(file => file.path === path), `packed skill is missing ${path}`);
  }
}
