import { Effect, Schema } from 'effect';
import { io, mustRun, PerfError } from './process.ts';
import type { BenchScenario } from './scenario.ts';
const Declarations = Schema.Struct({ operation: Schema.Literal('code-list'), codes: Schema.Array(Schema.Struct({ id: Schema.String, file: Schema.String, line: Schema.Int, endLine: Schema.Int, scope: Schema.Literals(['file', 'node', 'region']), symbol: Schema.optionalKey(Schema.String), contracts: Schema.Array(Schema.String) })), sourceRoots: Schema.Array(Schema.String), analysis: Schema.Json });
export const defaultBase = Effect.fn('perf.defaultBase')(function*(root: string, outputDir: string) {
  return (yield* mustRun(['git', 'merge-base', 'origin/master', 'HEAD'], { cwd: root, outputDir })).stdout.trim();
});
export function selectScenarios(scenarios: readonly BenchScenario[], selectors: readonly string[], changed?: { files: readonly string[]; features: readonly string[] }): BenchScenario[] {
  for (const selector of selectors) if (!scenarios.some(s => s.id === selector || s.id.startsWith(`${selector}/`))) throw new PerfError({ message: `Unknown scenario or feature: ${selector}` });
  const allChanged = changed?.files.some(file => file.startsWith('scripts/perf/') || file.startsWith('bench/fixtures/'));
  return scenarios.filter(s => (selectors.length === 0 || selectors.some(selector => s.id === selector || s.id.startsWith(`${selector}/`)))
    && (!changed || allChanged || changed.features.includes(s.id.split('/')[0]!) || changed.files.includes(`bench/${s.id.split('/')[0]}.bench.ts`)));
}
export const changedSelection = Effect.fn('perf.changedSelection')(function*(root: string, entry: string, base: string, outputDir: string) {
  const diff = yield* mustRun(['git', 'diff', '--name-only', '-z', base, '--'], { cwd: root, outputDir });
  const untracked = yield* mustRun(['git', 'ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, outputDir });
  const files = [...new Set((diff.stdout + untracked.stdout).split('\0').filter(Boolean))];
  const output = yield* mustRun([process.execPath, entry, '--root', root, '--json', 'code', 'list'], { cwd: root, outputDir });
  const declarations = yield* io('Decode code ownership declarations', () => Schema.decodeUnknownSync(Schema.fromJsonString(Declarations), { onExcessProperty: 'error' })(output.stdout));
  const refs = declarations.codes.filter(code => files.includes(code.file)).flatMap(code => code.contracts);
  const features = [...new Set([...files, ...refs].flatMap(path => { const match = /^docs\/feature\/([^/]+)\//u.exec(path); return match ? [match[1]!] : []; }))];
  return { files, features };
});
/** CLI help renders the current top-level command definitions. */
export const commandGroups = Effect.fn('perf.commandGroups')(function*(entry: string, root: string, outputDir: string) {
  const help = yield* mustRun([process.execPath, entry, '--help'], { cwd: root, outputDir, env: { NO_COLOR: '1' } });
  const section = help.stdout.split(/SUBCOMMANDS\s*\n/u)[1]?.split(/\n[A-Z][A-Z ]+:?\n/u)[0] ?? '';
  const groups = [...section.matchAll(/^ {2}([a-z][a-z0-9-]*)(?: {2,}|$)/gmu)].map(match => match[1]!);
  if (groups.length === 0) return yield* new PerfError({ message: `No command groups found in CLI help: ${help.stdout}` });
  return [...new Set(groups)];
});
