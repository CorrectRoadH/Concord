// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#执行管线
import { safeRunnerEnvironment } from "../../base/process/index.js";
import type { CommandEvidence, NativeEvidence, Evidence } from "../../model/index.js";
import { Effect } from "effect";
import { ConcordError, failure, objectDigest, type AnnotatedCase, type DocumentRecord, type Repository, type shared_Runner as Runner } from "../../model/index.js";
import { hasConfirmedOwnedGroupCleanup, OwnedProcess, runOwnedProcess, type OwnedProcessResult } from "../../base/process/index.js";
import type { Sources } from '../../base/sources/index.js';
import type { LocalRepository } from "../../base/workspace/index.js";
import { Publication, acquireTraceLeaseSync, releaseTraceLeaseSync } from "../../base/publication/index.js";
import { beginRun, finalizeRun, finishRun, quarantineRun } from "../../base/publication/index.js";
import { adapterFor, executeNativeCase } from "./test-adapters.js";
import { nativeVerdict } from "../../model/index.js";

export function runnerArguments(runner: Runner, selected: AnnotatedCase): readonly string[] {
  if (selected.status !== 'active' || selected.skipped) throw new ConcordError('CaseNotRunnable', 'Only active, runnable markers can execute');
  const named = selected.named === true;
  const pattern = named ? `^${selected.name.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&')}$` : '.*';
  if (runner.kind === 'node-test') return ['node', '--test', '--test-reporter=tap', ...(named ? ['--test-name-pattern', pattern] : []), selected.file];
  const replacements: Record<string, string> = { '{file}': selected.file, '{name}': selected.name, '{pattern}': pattern };
  return runner.argv.map(part => {
    if (/\{[^}]*\}/u.test(part) && !(part in replacements)) throw new ConcordError('InvalidRunner', 'Runner placeholders must occupy an entire argument and be file, name, or pattern');
    return replacements[part] ?? part;
  });
}

/** Unknown command counts stay unknown; explicit zero/all-skipped counts invalidate a run. */
export function commandObservation(result: OwnedProcessResult, runner: Runner): Pick<CommandEvidence, 'commandOutcome' | 'execution'> {
  if (result.outputLimitExceeded || result.timedOut || result.cancelled || result.signal !== null || result.exitCode === null || result.error !== undefined || !hasConfirmedOwnedGroupCleanup(result)) return { execution: 'unknown', commandOutcome: 'invalid' };
  const tap = `${result.stdout}\n${result.stderr}`;
  const count = (name: string) => [...tap.matchAll(new RegExp(`^# ${name} (\\d+)\\s*$`, 'gmu'))].map(match => Number(match[1])).at(-1);
  const tests = count('tests'), pass = count('pass'), failed = count('fail'), skipped = count('skipped'), todo = count('todo');
  let execution: CommandEvidence['execution'] = 'unknown';
  if (tests !== undefined && pass !== undefined && failed !== undefined && skipped !== undefined && todo !== undefined && pass + failed + skipped + todo === tests) execution = tests === 0 ? 'none' : pass + failed > 0 ? 'ran' : 'skipped';
  // A command runner can report no per-case counts, including a build failure.
  if (execution === 'none' || execution === 'skipped' || runner.kind === 'node-test' && execution === 'unknown') return { execution, commandOutcome: 'invalid' };
  return { execution, commandOutcome: result.exitCode === 0 ? 'pass' : 'fail' };
}

/** One runner owner spans all child scopes; unknown cleanup preserves quarantine. */
export const withRunner = <A, R>(repo: LocalRepository, run: (release: () => void, cleanupUnknown: () => void) => Effect.Effect<A, ConcordError, OwnedProcess | R>): Effect.Effect<A, ConcordError, OwnedProcess | R> => Effect.scoped(Effect.gen(function* () {
  const process = yield* OwnedProcess;
  let released = false;
  let cleanupUnknown = false;
  const lease = yield* Effect.acquireRelease(
    Effect.try({ try: () => repo.snapshot(() => beginRun(repo.root)), catch: failure }),
    lease => Effect.gen(function* () {
      if (released) return;
      const idle = (yield* process.activeCount) === 0;
      const results = yield* process.cleanupResults;
      yield* Effect.sync(() => {
        const lock = acquireTraceLeaseSync(repo.root, 'exclusive', 'test-finalize')!;
        try { const clean = !cleanupUnknown && idle && results.every(hasConfirmedOwnedGroupCleanup); finalizeRun(repo.root, lease, clean); if (clean) finishRun(repo.root, lease); else quarantineRun(repo.root, lease); }
        catch (cause) { quarantineRun(repo.root, lease); throw cause; }
        finally { releaseTraceLeaseSync(lock, 'test-finalize'); }
      });
    }),
  );
  return yield* run(() => {
    if (finalizeRun(repo.root, lease, true)) throw new ConcordError('FileChangedSinceRead', 'Publication invalidated the running verification');
    if (cleanupUnknown) throw new ConcordError('FixUnverifiable', 'Runner worktree cleanup is unconfirmed');
    finishRun(repo.root, lease); released = true;
  }, () => { cleanupUnknown = true; quarantineRun(repo.root, lease); });
})).pipe(Effect.catchDefect(cause => Effect.fail(failure(cause))));

export const executeCommand = (cwd: string, runner: Runner, selected: AnnotatedCase) => runOwnedProcess(runnerArguments(runner, selected), { cwd, env: safeRunnerEnvironment(), timeoutMs: runner.timeoutMs }).pipe(Effect.scoped, Effect.map(result => ({ ...commandObservation(result, runner), operation: 'test-run' as const, scope: 'command' as const, selectedCaseId: selected.id, exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, cancelled: result.cancelled, cleanupOk: hasConfirmedOwnedGroupCleanup(result), arguments: result.command })), Effect.mapError(failure));

export const runCommandCase = (repo: LocalRepository, selected: AnnotatedCase, _documents: readonly DocumentRecord[]): Effect.Effect<CommandEvidence, ConcordError, OwnedProcess> => withRunner(repo, release => Effect.gen(function* () {
  const runner = requireRunner(repo);
  const before = objectDigest({ config: repo.configSnapshot.source, test: repo.read(selected.file), sources: runner.sourceFiles.map(path => repo.read(path)), contract: repo.read(selected.contract.split('#')[0]!) });
  const result = yield* executeCommand(repo.root, runner, selected);
  return yield* Effect.try({ try: () => repo.snapshot(() => {
    const after = objectDigest({ config: repo.read(repo.configSnapshot.path), test: repo.read(selected.file), sources: runner.sourceFiles.map(path => repo.read(path)), contract: repo.read(selected.contract.split('#')[0]!) });
    release(); return before === after ? result : { ...result, commandOutcome: 'invalid' as const };
  }), catch: failure });
}));

export const runCase = (repo: LocalRepository, selected: AnnotatedCase, documents: readonly DocumentRecord[], options: { requireNative?: boolean } = {}): Effect.Effect<Evidence, ConcordError, OwnedProcess | Sources | Publication> => Effect.gen(function* () {
  if (!adapterFor(repo, selected.file)) {
    if (options.requireNative) return yield* Effect.fail(new ConcordError('NativeSelectionUnsupported', 'No adapter covers this source marker'));
    return yield* runCommandCase(repo, selected, documents);
  }
  const execution = yield* executeNativeCase(repo, selected, options.requireNative);
  if (!execution) return yield* runCommandCase(repo, selected, documents);
  const complete = execution.report.completeness.complete && execution.report.capabilities.perItemReport && execution.report.capabilities.exactSelection;
  return { operation: 'test-run', scope: 'native', selectedCaseId: selected.id, commandOutcome: nativeVerdict(execution.requested, execution.report.observed, execution.statuses, complete, execution.plan.invocations), execution: 'unknown', exitCode: execution.statuses.every(status => status.exitCode === 0) ? 0 : execution.statuses.find(status => status.exitCode !== 0)?.exitCode ?? null, signal: execution.statuses.find(status => status.signal !== null)?.signal ?? null, timedOut: execution.statuses.some(status => status.timedOut), cancelled: execution.statuses.some(status => status.cancelled), cleanupOk: execution.statuses.every(status => status.cleanup === 'complete'), arguments: ['native-adapter', execution.adapter.id], adapterId: execution.adapter.id, requested: execution.requested, observed: execution.report.observed, inputs: execution.inputs, definitionDigest: objectDigest({ selected, inputs: execution.inputs, plan: execution.plan, versions: execution.versions }), planId: execution.planId, planDigest: objectDigest(execution.plan), manifestDigest: objectDigest(execution.manifest), statuses: execution.statuses, assignments: execution.plan.invocations.map(invocation => ({ invocationId: invocation.invocationId, requested: invocation.requested })), capabilities: execution.report.capabilities, versions: execution.versions, commandExecutionCount: execution.statuses.length, complete, gaps: [...new Set(['ExternalInputUnknown', ...execution.report.completeness.gaps])] } satisfies NativeEvidence;
}).pipe(Effect.mapError(failure));

export function requireRunner(repo: Repository): Runner { if (!repo.config.runner) throw new ConcordError('FixUnverifiable', 'Configure a runner before executing tests or fix verification'); return repo.config.runner; }
