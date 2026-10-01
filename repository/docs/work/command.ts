import { Effect, Option } from 'effect';
import { Argument, Command, Flag } from 'effect/unstable/cli';
import { defineDocsCommandContribution, type TerminalDeliverySink } from '../contribution.js';
import { readJson } from '../../cli-support.js';
import { problem } from './model.js';
import { prepareDocsWork, showDocsWork, checkDocsWork, finalizeDocsWork } from './domain.js';

export interface WorkSettings { readonly root?: string | undefined; readonly json: boolean; readonly dryRun?: boolean }
export function makeDocsWorkCommand<SettingsR = never>(deliver: TerminalDeliverySink, settings?: Effect.Effect<WorkSettings, never, SettingsR>) {
  const group = Command.make('work').pipe(Command.withDescription('Partition documentation write sets, re-run checks and finalize verified work.'), Command.withSharedFlags({
    root: Flag.string('root').pipe(Flag.optional), json: Flag.boolean('json').pipe(Flag.withDefault(false)),
  }));
  const option = (name: string) => Flag.string(name).pipe(Flag.optional);
  const runId = Argument.string('run-id');
  const invoke = <A, E, R>(operation: (settings: WorkSettings) => Effect.Effect<A, E, R>) => Effect.gen(function*() {
    const local = yield* group;
    const inherited: WorkSettings = settings ? yield* settings : { json: false };
    const resolved = { ...inherited, root: Option.getOrUndefined(local.root) ?? inherited.root, json: local.json || inherited.json };
    if (resolved.dryRun) return yield* deliver({ stdout: '', stderr: resolved.json ? `${JSON.stringify({ ok: false, error: 'InvalidInput', message: 'Docs Work does not accept --dry-run' })}\n` : 'InvalidInput: Docs Work does not accept --dry-run\n', exitCode: 1 });
    return yield* operation(resolved).pipe(Effect.matchEffect({
      onFailure: error => {
        const value = error as { code?: string; _tag?: string; message?: string; details?: unknown };
        const known = value._tag === 'DocsWorkError';
        const result = { ok: false, error: known ? value.code! : 'RepositoryToolError', message: known ? value.message! : 'Docs Work operation failed', ...(known && value.details !== undefined ? { details: value.details } : {}) };
        return deliver({ stdout: '', stderr: `${resolved.json ? JSON.stringify(result) : `${result.error}: ${result.message}`}\n`, exitCode: 1 });
      },
      onSuccess: value => {
        const result = value as { receipt?: { checks: readonly { status: string }[] }; status?: string };
        const failed = result.receipt?.checks.some(check => check.status !== 'passed') || result.status === 'failed' || result.status === 'blocked';
        return deliver({ stdout: `${JSON.stringify(value, null, resolved.json ? undefined : 2)}\n`, stderr: '', exitCode: failed ? 1 : 0 });
      },
    }));
  });
  return group.pipe(Command.withSubcommands([
    Command.make('prepare', { scope: Flag.string('scope').pipe(Flag.atLeast(0)), plan: option('plan'), base: option('base'), runId: option('run-id') }, args => invoke(s => Effect.gen(function*() {
      const path = Option.getOrUndefined(args.plan);
      return yield* prepareDocsWork({ root: s.root, scopes: args.scope, base: Option.getOrUndefined(args.base), runId: Option.getOrUndefined(args.runId), ...(path === undefined ? {} : { plan: yield* readJson(path).pipe(Effect.mapError(() => problem('Invalid plan JSON', [{ code: 'UnsafePath', message: 'Cannot read plan JSON' }]))) }) });
    }))),
    Command.make('show', { runId }, args => invoke(s => showDocsWork(args.runId, s.root))),
    Command.make('check', { runId, itemId: Argument.string('item-id'), report: Flag.boolean('report').pipe(Flag.withDefault(false)), verify: option('verify') }, args => invoke(s => checkDocsWork(args.runId, args.itemId, { report: args.report, verify: Option.getOrUndefined(args.verify) }, s.root))),
    Command.make('finalize', { runId }, args => invoke(s => finalizeDocsWork(args.runId, s.root))),
  ]));
}
export const docsWorkCommandContribution = defineDocsCommandContribution({ name: 'work', summary: 'Coordinate documentation work and verify declared checks.', makeCommand: deliver => makeDocsWorkCommand(deliver) });
