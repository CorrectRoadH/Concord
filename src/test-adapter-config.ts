// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/run-native-test-adapters.md
import { Schema } from 'effect';

const text = Schema.String.check(Schema.isMinLength(1));
const path = text.check(Schema.makeFilter(value => !value.includes('\\') && !value.includes('\0') && !value.startsWith('/') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..' && part !== '.git')));
const limit = (maximum: number) => Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum })));
export const TestAdapterSchema = Schema.Struct({
  id: text.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)),
  include: Schema.NonEmptyArray(path),
  builtin: Schema.optional(Schema.Literals(['node-test', 'vitest', 'pytest', 'go', 'cargo'])),
  argv: Schema.optional(Schema.NonEmptyArray(text)),
  implementationFiles: Schema.Array(path),
  inputRoots: Schema.Array(path),
  frameworkVersion: text,
  lockFiles: Schema.Array(path),
  envNames: Schema.Array(text.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/u))),
  collectTimeoutMs: limit(60_000), runTimeoutMs: limit(300_000), wallTimeoutMs: limit(600_000),
  budgets: Schema.optional(Schema.Struct({ responseBytes: limit(8 * 1024 * 1024), outputBytes: limit(16 * 1024 * 1024), cases: limit(100_000), invocations: limit(128), reportFiles: limit(64), reportFileBytes: limit(8 * 1024 * 1024), reportBytes: limit(32 * 1024 * 1024) })),
}).check(Schema.makeFilter(value => (value.builtin === undefined) !== (value.argv === undefined) && (value.argv === undefined || value.implementationFiles.length > 0)));
export type TestAdapter = typeof TestAdapterSchema.Type;
export const inPath = (file: string, root: string): boolean => file === root || file.startsWith(`${root}/`);
export function validAdapters(config: { readonly testRoots: readonly string[]; readonly testAdapters?: readonly TestAdapter[] }): boolean {
  const adapters = config.testAdapters ?? [];
  const includes = adapters.flatMap(adapter => adapter.include);
  return new Set(adapters.map(adapter => adapter.id)).size === adapters.length && includes.every(root => config.testRoots.some(testRoot => inPath(root, testRoot))) && includes.every((root, index) => includes.every((other, second) => index === second || !inPath(root, other) && !inPath(other, root)));
}
