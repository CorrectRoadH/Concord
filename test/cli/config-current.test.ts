import { initialize } from '../support/operations.ts';
import '../support/support.ts';
import { runCli } from '../support/cli.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { tmpdir } from '../support/temporary.ts';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { snapshot } from "../../src/base/workspace/index.ts";
import { LocalRepository } from "../support/repository.ts";

import { digest } from "../../src/model/index.ts";

const fixture = async (body: (root: string) => Promise<void>) => {
  const root = mkdtempSync(join(tmpdir(), 'concord-ts-only-'));
  try { execFileSync('git', ['init', '-q', root]); await body(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
};

// @use-case docs/feature/project-onboarding/use-case/maintain-project-config.md
test('packed config commands reject non-current data and syntax without rewriting the source', () => Effect.runPromise(Effect.promise(async () => fixture(async root => {
  const repo = (await LocalRepository.open(root, { initialize: true }));
  try { (await initialize(repo, false, { testRoots: [] })); } finally { repo.close(); }
  const path = join(root, 'concord.config.ts');
  const current = readFileSync(path, 'utf8');
  for (const [source, code] of [['export default { format: \"concord.project/v1\" };', 'InvalidData'], ['export default { ...{} };\n', 'InvalidConfigSyntax']] as const) {
    writeFileSync(path, source);
    const result = await runCli({ argv: ['--root', root, '--json', 'config', 'show'], cwd: process.cwd(), env: process.env, signal: AbortSignal.timeout(20000) });
    assert.equal(result.exitCode, 1, result.stdout + result.stderr);
    assert.match(result.stderr, new RegExp(code));
    assert.equal(readFileSync(path, 'utf8'), source);
  }
}))));
