import { initialize } from '../support/operations.js';
import { installedConcordCli } from '../support/support.js';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { tmpdir } from '../support/temporary.js';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { snapshot } from "../../src/base/workspace/index.js";
import { LocalRepository } from "../support/repository.js";

import { digest } from "../../src/model/index.js";

const cli = installedConcordCli();
const fixture = (body: (root: string) => void) => {
  const root = mkdtempSync(join(tmpdir(), 'concord-ts-only-'));
  try { execFileSync('git', ['init', '-q', root]); body(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
};

// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('packed config commands reject non-current data and syntax without rewriting the source', () => Effect.runPromise(Effect.sync(() => fixture(root => {
  const repo = new LocalRepository(root, { initialize: true });
  try { initialize(repo, false, { testRoots: [] }); } finally { repo.close(); }
  const path = join(root, 'concord.config.ts');
  const current = readFileSync(path, 'utf8');
  for (const [source, code] of [['export default { format: \"concord.project/v1\" };', 'InvalidData'], ['export default { ...{} };\n', 'InvalidConfigSyntax']] as const) {
    writeFileSync(path, source);
    const result = spawnSync(process.execPath, [cli, '--root', root, '--json', 'config', 'show'], { encoding: 'utf8', timeout: 20_000 });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, new RegExp(code));
    assert.equal(readFileSync(path, 'utf8'), source);
  }
}))));
