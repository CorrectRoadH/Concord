import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';

const cli = resolve('dist/entry.js');
const run = (root: string, args: readonly string[], status = 0): string => {
  const output = spawnSync(process.execPath, [cli, '--root', root, '--json', '--fresh', ...args], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(output.status, status, JSON.stringify({ args, stdout: output.stdout, stderr: output.stderr, error: output.error }));
  return output.stdout || output.stderr;
};
const withConsumer = (name: string, body: (root: string) => void): void => {
  const root = mkdtempSync(join(tmpdir(), `concord-constitution-${name}-`));
  try { execFileSync('git', ['init', '-q', root]); body(root); }
  finally { rmSync(root, { recursive: true, force: true }); }
};
const Finding = Schema.Struct({ code: Schema.String, path: Schema.optional(Schema.String), line: Schema.optional(Schema.Number) });
const CheckView = Schema.Struct({ findings: Schema.Array(Finding) });
const checkFindings = (output: string) => Schema.decodeUnknownSync(Schema.fromJsonString(CheckView), { onExcessProperty: 'ignore' })(output).findings;

// @use-case docs/feature/project-onboarding/use-case/evolve-constitution.md#check-links
// @regression memory/constitution-body-links-unchecked.md
test('check reports a body link to a missing constitution clause with its path and line', () => Effect.runPromise(Effect.sync(() => withConsumer('broken-link', root => {
  run(root, ['init', '--docs-only']);
  run(root, ['feature', 'create', 'cart', '--title', 'Cart']);
  const path = 'docs/feature/cart/README.md';
  appendFileSync(join(root, path), '\n见 [C-099](../../constitution.md#c-099)。\n');
  const line = readFileSync(join(root, path), 'utf8').split('\n').findIndex(text => text.includes('#c-099')) + 1;
  const broken = checkFindings(run(root, ['check'], 1)).filter(finding => finding.code === 'AnchorNotFound');
  assert.deepEqual(broken.map(finding => ({ path: finding.path, line: finding.line })), [{ path, line }]);
}))));
