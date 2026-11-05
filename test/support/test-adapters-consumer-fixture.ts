import { packageBin } from '../../scripts/package-location.js';
import assert from 'node:assert/strict';
import { existsSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from './temporary.js';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { OwnedProcessLive, hasSuccessfulOwnedProcessResult, runOwnedProcess } from "../../src/base/process/index.js";
import { ProjectSchema } from "../../src/model/index.js";
import { renderTypeScriptConfig, parseTypeScriptConfig } from "../../src/base/workspace/index.js";
import { type test_adapter_config_TestAdapter as TestAdapter } from "../../src/model/index.js";
import { LocalRepository } from "./repository.js";
import { closeRepositoryCache, PersistentCache, type RepositoryCache } from "../../src/base/cache/index.js";
import { prepareSourceConsumer, sourceConcord } from './installed-package.js';

export const sourceRoot = fileURLToPath(new URL('../..', import.meta.url));
export const text = (root: string, path: string, value: string) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), value); };
export const scratch = Effect.acquireRelease(Effect.sync(() => mkdtempSync(join(tmpdir(), 'concord-adapter-packed-'))), root => Effect.sync(() => rmSync(root, { recursive: true, force: true })));
export const command = (argv: readonly string[], cwd: string) => runOwnedProcess(argv, { cwd, timeoutMs: 120_000, outputLimitBytes: 8 * 1024 * 1024 }).pipe(Effect.scoped, Effect.mapError(error => new Error(error.detail)));
export const requireCommand = Effect.fn('adapterTest.command')(function* (argv: readonly string[], cwd: string) {
  const result = yield* command(argv, cwd); assert.ok(hasSuccessfulOwnedProcessResult(result), `${argv.join(' ')}\n${JSON.stringify(result)}`); return result;
});
export const parse = (source: string): Record<string, unknown> => Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(JSON.parse(source));
export const CaseList = Schema.Struct({ cases: Schema.Array(Schema.Struct({ id: Schema.String })) });
export const Receipt = Schema.Struct({ scope: Schema.String, commandOutcome: Schema.String, definitionDigest: Schema.optional(Schema.String), requested: Schema.optional(Schema.Array(Schema.String)), gaps: Schema.optional(Schema.Array(Schema.String)), commandExecutionCount: Schema.optional(Schema.Int), versions: Schema.optional(Schema.Struct({ framework: Schema.String, runtime: Schema.String })) });
export const setup = Effect.fn('adapterTest.pack')(function* (root: string, needsEffect = false) {
  return yield* Effect.sync(() => {
    const packed = sourceConcord(); const tool = join(root, 'tool');
    mkdirSync(tool); text(tool, 'package.json', JSON.stringify({ private: true, type: 'module' }));
    const fixtureDependencies: string[] = [];
    if (needsEffect) {
      const { dependencies } = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ dependencies: Schema.Struct({ effect: Schema.String }) })))(readFileSync(join(sourceRoot, 'package.json'), 'utf8'));
      // Only the external fixture imports Effect; framework consumers use package dependencies.
      fixtureDependencies.push(`effect@${dependencies.effect}`);
    }
    prepareSourceConsumer(tool, packed, ['vitest@4.1.11', ...fixtureDependencies]);
    return { cli: packageBin(join(tool, 'node_modules/concord-sdlc')), tool };
  });
});
export const prepare = Effect.fn('adapterTest.consumer')(function* (scratch: string, name: string, cli: string, tool: string) {
  const root = join(scratch, name); yield* Effect.sync(() => mkdirSync(root));
  yield* requireCommand(['git', 'init', '-q'], root);
  yield* requireCommand([process.execPath, cli, '--root', root, 'init', '--json'], root);
  yield* requireCommand([process.execPath, cli, '--root', root, 'new', 'feature', 'example', '--title', 'Example', '--json'], root);
  yield* Effect.sync(() => {
    text(root, 'package.json', '{"private":true,"type":"module"}');
    symlinkSync(join(tool, 'node_modules'), join(root, 'node_modules'), 'dir');
    text(root, '.gitignore', 'node_modules\n**/target/\n**/__pycache__/\n**/.pytest_cache/\n');
  });
  return root;
});
export const configure = (root: string, adapters: readonly TestAdapter[], sourceIgnore: readonly string[] = []) => {
  const configPath = join(root, 'concord.config.ts');
  const config = existsSync(configPath) ? parseTypeScriptConfig(readFileSync(configPath, 'utf8')) : {};
  writeFileSync(join(root, 'concord.config.ts'), renderTypeScriptConfig(Schema.decodeUnknownSync(ProjectSchema)({ ...config, runner: { kind: 'node-test', sourceFiles: [], timeoutMs: 60000 }, testAdapters: adapters, sourceIgnore })));
};
export const call = (root: string, cli: string, args: readonly string[]) => command([process.execPath, cli, '--root', root, '--json', ...args], root);
export const success = Effect.fn('adapterTest.cli')(function* (root: string, cli: string, args: readonly string[]) {
  const result = yield* call(root, cli, args); assert.equal(result.exitCode, 0, `${args.join(' ')}\n${result.stderr}\n${result.stdout}`); return result;
});
export const idFor = Effect.fn('adapterTest.id')(function* (root: string, cli: string) {
  const list = yield* success(root, cli, ['test', 'list']); return Schema.decodeUnknownSync(CaseList)(JSON.parse(list.stdout)).cases[0]!.id;
});
export const environment = ['NODE_OPTIONS', 'PATH', 'HOME', 'UV_CACHE_DIR', 'UV_PYTHON_INSTALL_DIR', 'GOCACHE', 'GOPATH', 'CARGO_HOME', 'RUSTUP_HOME', 'RUSTUP_TOOLCHAIN', 'RUSTUP_AUTO_INSTALL', 'RUSTFLAGS', 'NIX_LD', 'NIX_LD_LIBRARY_PATH'];
export const builtin = (id: string, include: string, name: TestAdapter['builtin'], version: string, inputRoots: readonly string[] = []): TestAdapter => ({ id, include: [include], builtin: name, frameworkVersion: version, implementationFiles: [], inputRoots, lockFiles: [], envNames: environment });

export { packageBin };
export { assert };
export { existsSync };
export { copyFileSync };
export { mkdirSync };
export { mkdtempSync };
export { readFileSync };
export { rmSync };
export { symlinkSync };
export { writeFileSync };
export { join };
export { tmpdir };
export { fileURLToPath };
export { test };
export { Effect };
export { Schema };
export { OwnedProcessLive };
export { hasSuccessfulOwnedProcessResult };
export { runOwnedProcess };
export { ProjectSchema };
export { renderTypeScriptConfig };
export { parseTypeScriptConfig };
export type { TestAdapter };
export { LocalRepository };
export { closeRepositoryCache };
export const withPersistentCache = <A>(repo: import('../../src/model/index.js').Repository, _writable: boolean, use: (cache: RepositoryCache) => A): A => use(PersistentCache.repository(repo));
export { prepareSourceConsumer };
export { sourceConcord };
