import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { CodeDeclarationSchema } from '../dist/code.js';
import { ProjectSchema } from '../dist/shared.js';
import { readProjectConfig, writeProjectConfig } from './support.js';
import { caseDiscriminator, deriveTestReference } from '../dist/test-reference.js';

// @use-case docs/feature/local-sdlc/use-case/trace-code-ownership.md
test('packed CLI traces code scopes and preserves the original fixed evidence gate', () => Effect.runPromise(Effect.sync(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'concord-code-cli-'));
  try {
    const packed = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.Struct({ filename: Schema.String }))))(
      execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], { cwd: resolve('.'), encoding: 'utf8', timeout: 60000 }),
    );
    assert.ok(packed[0]);
    const install = join(scratch, 'tool'); mkdirSync(install);
    writeFileSync(join(install, 'package.json'), JSON.stringify({ private: true }));
    execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', join(scratch, packed[0].filename)], { cwd: install, encoding: 'utf8', timeout: 60000 });
    const cli = join(install, 'node_modules/concord-sdlc/dist/entry.js');
    const root = join(scratch, 'consumer'); mkdirSync(root);
    execFileSync('git', ['init', '-q', root]);
    function call<A>(args: readonly string[], schema: Schema.ConstraintDecoder<A, never>, status = 0): A {
      const result = spawnSync(process.execPath, [cli, '--root', root, '--json', ...args], { encoding: 'utf8', timeout: 30000 });
      assert.equal(result.status, status, result.stdout + result.stderr);
      return Schema.decodeUnknownSync(Schema.fromJsonString(schema))(result.stdout.trim() || result.stderr.trim());
    }
    const codeHelp = spawnSync(process.execPath, [cli, '--root', root, 'code', '--help'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(codeHelp.status, 0, codeHelp.stderr);
    assert.doesNotMatch(codeHelp.stdout, /code show|\bshow\b/u);
    const annotateHelp = spawnSync(process.execPath, [cli, '--root', root, 'code', 'annotate', '--help'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(annotateHelp.status, 0, annotateHelp.stderr);
    assert.doesNotMatch(annotateHelp.stdout, /\bid\b/u);
    const ack = Schema.Struct({});
    const error = Schema.Struct({ error: Schema.String });
    const codes = Schema.Struct({ codes: Schema.Array(CodeDeclarationSchema) });
    const feature = 'docs/feature/orders/README.md';
    const useCase = 'docs/feature/orders/use-case/create-order.md';
    call(['init', '--docs-only', '--source-root', 'src', '--source-root', 'test'], ack);
    const config = readProjectConfig(root);
    assert.deepEqual(config.sourceRoots, ['src', 'test']);
    assert.deepEqual(config.testRoots, []);
    assert.deepEqual(call(['doctor'], Schema.Struct({ missingSourceRoots: Schema.Array(Schema.String) })).missingSourceRoots, ['src', 'test']);
    call(['feature', 'create', 'orders', '--title', 'Orders'], ack);
    call(['use-case', 'create', 'create-order', '--feature', feature, '--title', 'Create order'], ack);
    call(['feature', 'page', 'add', 'orders', 'behavior'], ack);
    call(['engineering', 'create', 'tooling', '--title', 'Tooling'], ack);
    call(['engineering', 'page', 'add', 'tooling', 'architecture'], ack);
    writeFileSync(join(root, 'docs/feature/orders/behavior.md'), '# Behavior\n\n## Normalize\n\n## Validate\n');
    const engineering = 'docs/engineering/tooling/README.md';
    const engineeringPage = 'docs/engineering/tooling/architecture.md';
    writeFileSync(join(root, engineeringPage), '# Architecture\n\n## Overview\n');
    mkdirSync(join(root, 'src')); mkdirSync(join(root, 'test'));
    const engineeringOwnerSnippet = call(['code', 'annotate', '--scope', 'node', '--contract', engineering], Schema.Struct({ snippet: Schema.String })).snippet;
    const engineeringPageSnippet = call(['code', 'annotate', '--scope', 'node', '--contract', `${engineeringPage}#overview`], Schema.Struct({ snippet: Schema.String })).snippet;
    assert.ok(engineeringOwnerSnippet.includes(`// @concord-implements ${engineering}`));
    assert.ok(engineeringPageSnippet.includes(`// @concord-implements ${engineeringPage}#overview`));
    assert.equal(call(['code', 'annotate', '--scope', 'node', '--contract', `${engineeringPage}#missing`], error, 1).error, 'AnchorNotFound');
    call(['research', 'create', 'research-target', '--title', 'Research target'], ack);
    call(['roadmap', 'create', 'roadmap-target', '--title', 'Roadmap target'], ack);
    assert.equal(call(['code', 'annotate', '--scope', 'node', '--contract', 'docs/research/research-target/README.md'], error, 1).error, 'InvalidReferenceTarget');
    assert.equal(call(['code', 'annotate', '--scope', 'node', '--contract', 'docs/roadmap/roadmap-target/README.md'], error, 1).error, 'InvalidReferenceTarget');
    const snippet = call(['code', 'annotate', '--scope', 'node', '--contract', useCase, '--contract', `${feature}#orders`], Schema.Struct({ snippet: Schema.String })).snippet;
    assert.ok(snippet.includes(`// @concord-implements ${useCase}`));
    assert.ok(!snippet.includes('code-') && !snippet.includes('声明 ID'));
    assert.deepEqual(call(['code', 'list'], codes).codes, [], 'annotate does not edit source');
    assert.equal(call(['code', 'annotate', '--scope', 'file'], error, 1).error, 'MissingCodeContract');
    assert.equal(call(['code', 'annotate', '--scope', 'node', '--contract', useCase, '--contract', useCase], error, 1).error, 'DuplicateCodeContract');
    assert.equal(call(['code', 'annotate', '--scope', 'node', '--contract', 'docs/feature/absent/README.md'], error, 1).error, 'ReferenceNotFound');
    const source = [
      '// @concord-file', `// @concord-implements ${feature}`, '',
      snippet.trimEnd(), 'export function normalize(input: string) {',
      '  // @concord-begin', `  // @concord-implements ${useCase}`,
      '  const trimmed = input.trim();', '  const result = trimmed.toLowerCase();',
      '  // @concord-end', '  return result;', '}', '',
      '// @concord-code',
      '// @concord-implements docs/feature/orders/behavior.md#normalize',
      '// @concord-implements docs/feature/orders/behavior.md#validate',
      `// @concord-implements ${engineeringPage}#overview`,
      'export const validate = (input: string) => input.length > 0;', '',
    ].join('\n');
    writeFileSync(join(root, 'src/orders.ts'), source);
    const first = call(['code', 'list'], codes).codes;
    assert.equal(first.length, 4);
    assert.deepEqual(new Set(first.map(item => item.scope)), new Set(['file', 'node', 'region']));
    const region = first.find(item => item.scope === 'region'); assert.ok(region);
    const normalize = first.find(item => item.symbol === 'normalize'); assert.ok(normalize);
    const anchor = first.find(item => item.symbol === 'validate'); assert.ok(anchor);
    assert.equal(region.line, source.split('\n').findIndex(line => line.includes('const trimmed')) + 1);
    assert.equal(region.endLine, region.line + 1);
    const located = call(['code', 'locate', 'src/orders.ts', '--line', String(region.line)], codes).codes;
    assert.deepEqual(new Set(located.map(item => item.id)), new Set([first.find(item => item.scope === 'file')?.id, normalize.id, region.id]));
    assert.equal(call(['code', 'locate', 'src/orders.ts', '--line', '0'], error, 1).error, 'InvalidCodeLine');
    assert.equal(call(['code', 'locate', 'src/orders.ts', '--line', '999'], error, 1).error, 'InvalidCodeLine');
    assert.equal(call(['code', 'locate', 'README.md', '--line', '1'], error, 1).error, 'CodeSourceNotScanned');
    const traced = call(['trace', 'show', 'orders'], Schema.Struct({ codeDeclarations: Schema.Array(Schema.Struct({ id: Schema.String, symbol: Schema.optional(Schema.String), matchedContracts: Schema.Array(Schema.String) })), tests: Schema.Array(Schema.Unknown) }));
    assert.equal(traced.codeDeclarations.length, 4); assert.deepEqual(traced.tests, []);
    assert.equal(traced.codeDeclarations.find(item => item.symbol === 'validate')?.matchedContracts.length, 2);
    assert.match(call(['review', 'render', 'orders'], Schema.String), /Code declarations/);
    const engineeringTrace = call(['trace', 'show', 'tooling'], Schema.Struct({ codeDeclarations: Schema.Array(Schema.Struct({ id: Schema.String, contracts: Schema.Array(Schema.String), matchedContracts: Schema.Array(Schema.String) })) }));
    assert.deepEqual(engineeringTrace.codeDeclarations.map(item => item.id), [anchor.id]);
    assert.deepEqual(engineeringTrace.codeDeclarations[0]?.matchedContracts, [`${engineeringPage}#overview`]);
    assert.deepEqual(engineeringTrace.codeDeclarations[0]?.contracts, [
      'docs/feature/orders/behavior.md#normalize',
      'docs/feature/orders/behavior.md#validate',
      `${engineeringPage}#overview`,
    ]);
    const engineeringShow = call(['engineering', 'show', 'tooling'], Schema.Struct({ codeDeclarations: Schema.Array(Schema.Struct({ id: Schema.String })) }));
    assert.deepEqual(engineeringShow.codeDeclarations.map(item => item.id), [anchor.id]);
    assert.match(call(['review', 'render', 'tooling'], Schema.String), /validate/);
    const check = call(['check'], Schema.Struct({ ok: Schema.Boolean, codeDeclarations: Schema.Int, cases: Schema.Int }));
    assert.deepEqual(check, { ok: true, codeDeclarations: 4, cases: 0 });
    writeFileSync(join(root, 'src/boundaries.ts'), `function last() {\n// @concord-begin\n// @concord-implements ${useCase}\nconst value = 1;\n// @concord-end\n}\n// @concord-begin\n// @concord-implements ${useCase}\nfunction whole() {}\n// @concord-end\n`);
    const terminalRegions = call(['code', 'list'], codes).codes.filter(item => item.file === 'src/boundaries.ts');
    assert.equal(terminalRegions.length, 2);
    rmSync(join(root, 'src/boundaries.ts'));
    call(['cache', 'rebuild'], ack);
    renameSync(join(root, 'src/orders.ts'), join(root, 'src/renamed.ts'));
    writeFileSync(join(root, 'src/renamed.ts'), '\n' + source);
    const moved = call(['code', 'list'], codes).codes.find(item => item.symbol === 'normalize'); assert.ok(moved);
    assert.equal(moved.file, 'src/renamed.ts');
    assert.equal(moved.line, normalize.line + 1);
    call(['cache', 'clear'], ack);
    rmSync(join(root, 'src/renamed.ts'));
    assert.deepEqual(call(['code', 'list'], codes).codes, []);

    // A code finding must not become an extra precondition for real red/green evidence.
    call(['memory', 'add', 'wrong-result', '--kind', 'problem', '--title', 'Wrong result'], ack);
    const problem = 'memory/wrong-result.md';
    writeProjectConfig(root, { ...config, testRoots: ['test'] });
    writeFileSync(join(root, 'test/result.test.mjs'), [
      "import test from 'node:test';", "import assert from 'node:assert/strict';", "import { result } from '../src/result.mjs';",
      `// @use-case ${useCase}`, `// @regression ${problem}`,
      "test('result', () => { assert.equal(result(), 2); });", '',
    ].join('\n'));
    const resultCase = deriveTestReference('test/result.test.mjs', 'test/result.test.mjs', caseDiscriminator(useCase, 0));
    const product = (value: number) => `// @concord-unknown-label invalid\nexport function result() { return ${value}; }\n`;
    writeFileSync(join(root, 'src/result.mjs'), product(1));
    assert.equal(call(['check'], Schema.Struct({ ok: Schema.Boolean }), 1).ok, false);
    assert.equal(call(['code', 'list'], error, 1).error, 'TraceInvalid');
    assert.equal(call(['test', 'list'], Schema.Struct({ cases: Schema.Array(Schema.Unknown) })).cases.length, 1);
    call(['test', 'show', resultCase], ack);
    const receipt = Schema.Struct({ id: Schema.String, commandOutcome: Schema.String });
    const red = call(['test', 'run', resultCase], receipt, 1); assert.equal(red.commandOutcome, 'fail');
    writeFileSync(join(root, 'src/result.mjs'), product(2));
    const green = call(['test', 'run', resultCase], receipt); assert.equal(green.commandOutcome, 'pass');
    assert.equal(call(['memory', 'resolve', 'wrong-result', '--kind', 'fixed', '--reason', 'fixed'], error, 1).error, 'EvidenceRequired');
    const resolveArgs = ['memory', 'resolve', 'wrong-result', '--kind', 'fixed', '--reason', 'fixed result', '--red', red.id, '--green', green.id];
    writeFileSync(join(root, 'src/result.mjs'), product(3));
    call(resolveArgs, error, 1); // The original candidate/definition gate still rejects stale evidence.
    writeFileSync(join(root, 'src/result.mjs'), product(2));
    call(resolveArgs, ack);
    assert.equal(call(['memory', 'show', 'wrong-result'], Schema.Struct({ document: Schema.Struct({ metadata: Schema.Struct({ resolution: Schema.Struct({ evidenceLevel: Schema.String }) }) }) })).document.metadata.resolution.evidenceLevel, 'command');
    const testFile = join(root, 'test/result.test.mjs');
    writeFileSync(testFile, readFileSync(testFile, 'utf8').replace(useCase, 'docs/feature/missing/README.md'));
    assert.equal(call(['test', 'list'], error, 1).error, 'TraceInvalid', 'original test reference validation remains enforced');
    writeProjectConfig(root, { ...config, sourceRoots: ['../escape'] });
    assert.equal(call(['doctor'], error, 1).error, 'UnsafePath');
    writeFileSync(join(root, 'concord.config.ts'), readFileSync(join(root, 'concord.config.ts'), 'utf8').replace(/"sourceRoots": \[[\s\S]*?\]/u, '"sourceRoots": "src"'));
    assert.equal(call(['doctor'], error, 1).error, 'InvalidData');

    const skill = spawnSync(process.execPath, [cli, '--skill', 'code'], { cwd: scratch, encoding: 'utf8', timeout: 10000 });
    assert.equal(skill.status, 0, skill.stderr); assert.match(skill.stdout, /code locate/);

    // Execute the shipped quick start itself; copied examples cannot prove the README works.
    const readme = readFileSync(join(install, 'node_modules/concord-sdlc/README.md'), 'utf8');
    const quickStart = readme.split('## Quick start\n')[1]?.split('\n## ')[0];
    const script = quickStart === undefined ? undefined : /```sh\n([\s\S]*?)\n```/u.exec(quickStart)?.[1];
    assert.ok(script, 'README must contain a runnable quick start');
    const demoRun = spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
      cwd: scratch, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, PATH: `${join(install, 'node_modules/.bin')}:${process.env.PATH ?? ''}` },
    });
    assert.equal(demoRun.status, 0, demoRun.stdout + demoRun.stderr);
    assert.match(demoRun.stdout, /"commandOutcome":"pass"/u);
    const demoCheck = spawnSync(process.execPath, [cli, '--root', join(scratch, 'concord-demo'), '--json', 'check'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(demoCheck.status, 0, demoCheck.stderr);
    assert.deepEqual(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ ok: Schema.Boolean, codeDeclarations: Schema.Int, cases: Schema.Int })))(demoCheck.stdout), { ok: true, codeDeclarations: 3, cases: 1 });
    const demoLocate = spawnSync(process.execPath, [cli, '--root', join(scratch, 'concord-demo'), '--json', 'code', 'locate', 'src/greeting.mjs', '--line', '9'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(demoLocate.status, 0, demoLocate.stderr);
    assert.deepEqual(new Set(Schema.decodeUnknownSync(Schema.fromJsonString(codes))(demoLocate.stdout).codes.map(item => item.scope)), new Set(['file', 'node', 'region']));
  } finally { rmSync(scratch, { recursive: true, force: true }); }
})));
