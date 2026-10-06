import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Effect, Schema } from 'effect';
import { io, mustRun, PerfError } from './process.js';

export interface ScaleSpec { readonly sources: number; readonly tests: number; readonly pages: number }
/** The default synthetic scale mirrors a large adopted game repository: thousands of sources and a thousand supporting pages. */
export const defaultScale: ScaleSpec = { sources: 3600, tests: 600, pages: 1000 };

export interface Consumer {
  readonly kind: 'self' | 'scale' | 'path';
  readonly root: string;
  readonly commit: string;
  readonly scale?: ScaleSpec;
  readonly cache?: 'ready';
}

const CacheStatus = Schema.Struct({ status: Schema.Literal('ready') });
const prepareCache = Effect.fn('perf.prepareCache')(function*(entry: string, root: string, outputDir: string) {
  const concord = (...args: string[]) => mustRun([process.execPath, entry, '--root', root, '--json', 'cache', ...args], { cwd: root, outputDir });
  yield* concord('rebuild');
  const status = yield* concord('status');
  yield* io('Verify consumer cache is ready', () => Schema.decodeUnknownSync(Schema.fromJsonString(CacheStatus))(status.stdout));
  return 'ready' as const;
});

const git = (cwd: string, outputDir: string, ...args: string[]) => mustRun(['git', ...args], { cwd, outputDir });
const commitAll = Effect.fn('perf.commitAll')(function*(root: string, outputDir: string, message: string) {
  yield* git(root, outputDir, 'add', '.');
  yield* git(root, outputDir, '-c', 'user.name=Concord perf', '-c', 'user.email=perf@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', message);
});
const headOf = Effect.fn('perf.headOf')(function*(root: string, outputDir: string) {
  return (yield* git(root, outputDir, 'rev-parse', 'HEAD')).stdout.trim();
});

/** Self-hosting consumer: an independent clone of this repository frozen at one commit; uncommitted edits are excluded by design. */
export const selfConsumer = Effect.fn('perf.selfConsumer')(function*(repository: string, commit: string, workDir: string) {
  const root = join(workDir, 'self');
  yield* mustRun(['git', 'clone', '-q', '--no-hardlinks', '--no-checkout', repository, root], { cwd: workDir, outputDir: workDir });
  yield* git(root, workDir, 'checkout', '-q', '--detach', commit);
  const cache = yield* prepareCache(join(repository, 'dist/entry.js'), root, workDir);
  return { kind: 'self', root, commit: yield* headOf(root, workDir), cache } satisfies Consumer;
});

/** Synthetic consumer created through the candidate's public CLI, then frozen in Git. */
export const scaleConsumer = Effect.fn('perf.scaleConsumer')(function*(entry: string, spec: ScaleSpec, workDir: string) {
  const root = join(workDir, 'scale');
  yield* io('Create scale root', () => mkdirSync(root));
  yield* git(root, workDir, 'init', '-q');
  const concord = (...args: string[]) => mustRun([process.execPath, entry, '--root', root, '--json', ...args], { cwd: root, outputDir: workDir });
  yield* concord('init', '--test-root', 'test', '--source-root', 'src', '--yes');
  yield* concord('feature', 'create', 'scale', '--title', 'Scale', '--no-pages');
  yield* concord('use-case', 'create', 'scale-read', '--title', 'Scale read', '--feature', 'docs/feature/scale/README.md');
  yield* io('Generate scale sources', () => {
    for (const folder of ['src', 'test', 'docs/feature/scale/pages']) mkdirSync(join(root, folder), { recursive: true });
    for (let index = 0; index < spec.sources; index++) {
      writeFileSync(join(root, 'src', `module-${index}.ts`), `// @concord-file\n// @concord-implements docs/feature/scale/README.md\nexport function value${index}(input: number): number {\n  return input + ${index};\n}\n`);
    }
    for (let index = 0; index < spec.tests; index++) {
      writeFileSync(join(root, 'test', `case-${index}.test.ts`), `import test from 'node:test';\n\n// @use-case docs/feature/scale/use-case/scale-read.md\ntest('scale case ${index}', () => {});\n`);
    }
    for (let index = 0; index < spec.pages; index++) {
      writeFileSync(join(root, 'docs/feature/scale/pages', `page-${index}.md`), `# Page ${index}\n\nSupporting page for [Scale](../README.md).\n`);
    }
  });
  yield* commitAll(root, workDir, 'Frozen scale consumer');
  const cache = yield* prepareCache(entry, root, workDir);
  return { kind: 'scale', root, commit: yield* headOf(root, workDir), scale: spec, cache } satisfies Consumer;
});

/** An existing consumer is measured in place and must be clean so its commit identifies the sources. */
export const pathConsumer = Effect.fn('perf.pathConsumer')(function*(path: string, workDir: string) {
  const root = yield* io('Resolve consumer', () => realpathSync(resolve(path)));
  const status = (yield* git(root, workDir, 'status', '--porcelain')).stdout.trim();
  if (status !== '') return yield* new PerfError({ message: `Consumer ${root} has uncommitted changes; measure a frozen clone instead` });
  return { kind: 'path', root, commit: yield* headOf(root, workDir) } satisfies Consumer;
});
