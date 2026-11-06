// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#修复核验
// @concord-implements docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md
import { Sources, snapshotBytes } from '../../base/sources/index.ts';
import { Publication } from '../../base/publication/index.ts';
import { Installation } from "../../base/installation/index.ts";
import { dirname, join } from "node:path";

import { Effect } from "effect";
import { scanAnnotations } from "./annotations.ts";
import { readDocumentSelector } from "../documents/index.ts";
import { closeIssue } from "../issues/index.ts";
import { executeCommand, requireRunner, withRunner } from "./evidence.ts";
import { safeRunnerEnvironment } from "../../base/process/index.ts";
import type { CommandEvidence } from "../../model/index.ts";
import { OwnedProcess, runOwnedProcess, hasConfirmedOwnedGroupCleanup } from "../../base/process/index.ts";
import { LocalRepository, git, parseTypeScriptConfig } from "../../base/workspace/index.ts";
import { ConcordError, canonical, digest, failure, objectDigest, type AnnotatedCase, type Repository, type FixVerificationSchema, type ProjectConfig, type Runner } from "../../model/index.ts";
import { commitRepository, firstParentPath, gitBlobBytes, resolveCommit } from "../../base/git/index.ts";

type Verification = typeof FixVerificationSchema.Type;
const sync = <A>(f: () => A) => Effect.try({ try: f, catch: failure });
function unavailable(message: string): never { throw new ConcordError('FixUnverifiable', message); }

const verificationFailure = (error: ConcordError): ConcordError => ['InvalidData', 'GitFailed', 'InvalidFile', 'OperationFailed', 'InvalidRunner', 'CleanupFailed', 'CleanupUnknown'].includes(error.code) ? new ConcordError('FixUnverifiable', error.message) : error;

function selectedTests(repo: Repository, issue: string, testId?: string): readonly AnnotatedCase[] {
  const scan = scanAnnotations(repo, { cache: 'off', sourceMode: 'overlay' });
  if (scan.findings.length) unavailable('Test markers cannot be decoded');
  const tests = scan.cases.filter(test => test.status === 'active' && !test.skipped && (testId === undefined ? test.issues.includes(issue) : test.id === testId)).sort((a, b) => a.id.localeCompare(b.id));
  if (!tests.length) unavailable(`No runnable @issue markers reference ${issue}`);
  return tests;
}
function configurationWithoutPreparation(config: ProjectConfig): ProjectConfig {
  if (config.runner === undefined) return config;
  const { prepare: _prepare, ...runner } = config.runner;
  return { ...config, runner };
}
function frozenInputs(repo: Repository, tests: readonly AnnotatedCase[], commit?: string) {
  const paths = [...new Set([...tests.map(test => test.file), ...requireRunner(repo).sourceFiles, ...tests.map(test => test.contract.split('#')[0]!)])].filter(path => path !== repo.configSnapshot.path).sort();
  return { runner: objectDigest(configurationWithoutPreparation(repo.configSnapshot.config)), configuration: repo.configSnapshot.path, tests: tests.map(test => test.id), files: paths.map(path => {
    const source = repo.read(path); if (source === undefined) unavailable(`Frozen runner input is unavailable: ${path}`);
    return { path, digest: digest(commit === undefined ? snapshotBytes(repo, path)! : gitBlobBytes(repo.root, commit, path)) };
  }) };
}
function freeze(repo: Repository, issue: string, defectInput: string | undefined, fix: string, testId?: string) {
  const tests = selectedTests(repo, issue, testId);
  const inputs = frozenInputs(repo, tests, fix);
  let defect: string;
  if (defectInput) defect = resolveCommit(repo.root, defectInput);
  else {
    if (git(repo.root, ['rev-parse', '--is-shallow-repository']) === 'true') unavailable('A shallow clone cannot establish the first regression commit');
    const history = git(repo.root, ['rev-list', '--first-parent', '--reverse', fix]).split('\n');
    const first = new Map<string, string>();
    for (const commit of history) {
      if (!git(repo.root, ['ls-tree', '-r', '--name-only', commit, '--', ...tests.map(test => test.file)])) continue;
      const historical = commitRepository(repo, commit);
      const scan = scanAnnotations(historical, { cache: 'off', sourceMode: 'overlay' });
      for (const test of scan.cases) if (tests.some(selected => selected.id === test.id) && test.issues.includes(issue) && !first.has(test.id)) first.set(test.id, commit);
      if (first.size === tests.length) break;
    }
    const commits = new Set(first.values());
    if (first.size !== tests.length || commits.size !== 1) unavailable('Regression tests first appeared in different commits; provide --defect');
    defect = [...commits][0]!;
  }
  const interval = firstParentPath(repo.root, defect, fix);
  if (interval.length < 2) unavailable('Fix must be after the defect commit');
  for (const commit of interval) {
    const historical = commitRepository(repo, commit);
    const historicTests = selectedTests(historical, issue, testId);
    if (canonical(frozenInputs(historical, historicTests, commit)) !== canonical(inputs)) unavailable(`Frozen tests, runner inputs, or referenced Spec changed in ${commit}`);
  }
  return { tests, inputs, defect, fix, runner: inputs.runner };
}
const inWorktree = <A>(repo: LocalRepository, commit: string, cleanupUnknown: () => void, run: (root: string, preserve: () => void) => Effect.Effect<A, ConcordError, OwnedProcess | Publication | Sources | Installation>): Effect.Effect<A, ConcordError, OwnedProcess | Publication | Sources | Installation> => Effect.scoped(Effect.gen(function* () {
  const invoke = (args: readonly string[]) => runOwnedProcess(['git', '-C', repo.root, '-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo.root, env: safeRunnerEnvironment(), timeoutMs: 10000 }).pipe(Effect.scoped, Effect.mapError(failure), Effect.flatMap(result => sync(() => {
    if (!hasConfirmedOwnedGroupCleanup(result)) preserve();
    if (result.exitCode !== 0 || result.timedOut || result.cancelled || result.signal !== null || result.error || !hasConfirmedOwnedGroupCleanup(result)) unavailable('Could not create or clean the verification worktree');
  })));
  const publication = yield* Publication;
  const scratch = yield* publication.scratchDirectory(repo.root, '', 'concord-verify-', 'temporary');
  let preserved = false;
  const preserve = () => { if (!preserved) { preserved = true; scratch.preserve(); cleanupUnknown(); } };
  const root = yield* Effect.acquireRelease(Effect.succeed(join(scratch.path, 'worktree')), root => Effect.gen(function* () {
    if (preserved) return;
    const registered = yield* sync(() => git(repo.root, ['worktree', 'list', '--porcelain']).split('\n').includes(`worktree ${root}`));
    if (registered) yield* invoke(['worktree', 'remove', '--force', root]);
    yield* scratch.remove;
  }).pipe(Effect.catch(error => Effect.sync(() => { preserve(); throw new ConcordError('FixUnverifiable', `Verification worktree cleanup is unconfirmed: ${root}`, error); })), Effect.orDie));
  yield* invoke(['worktree', 'add', '--detach', root, commit]);
  return yield* run(root, preserve);
}));

const assertFrozenRoot = Effect.fn('fixVerification.assertFrozenRoot')(function*(root: string, inputs: ReturnType<typeof frozenInputs>, code: string) {
  const sources = yield* Sources;
  const config = yield* sources.read(root, inputs.configuration).pipe(Effect.mapError(error => new ConcordError(code, error.message)));
  const configDigest = yield* sync(() => objectDigest(configurationWithoutPreparation(config === undefined ? {} : parseTypeScriptConfig(config, inputs.configuration))));
  if (configDigest !== inputs.runner) return yield* Effect.fail(new ConcordError(code, `Materialized project configuration changed: ${inputs.configuration}`));
  for (const file of inputs.files) {
    const bytes = yield* sources.readBytes(root, file.path).pipe(Effect.mapError(error => new ConcordError(code, error.message.includes('Symbolic') ? `Frozen input became a symbolic link: ${file.path}` : `Materialized frozen input is unavailable: ${file.path}`)));
    if (bytes === undefined || digest(bytes) !== file.digest) return yield* Effect.fail(new ConcordError(code, `Materialized frozen input changed: ${file.path}`));
  }
});

const prepareCheckout = Effect.fn('fixVerification.prepare')(function*(root: string, runner: Runner | undefined, cleanupUnknown: () => void) {
  if (runner === undefined) return;
  for (const [index, argv] of (runner.prepare ?? []).entries()) {
    const result = yield* runOwnedProcess(argv, { cwd: root, env: safeRunnerEnvironment(), timeoutMs: runner.timeoutMs }).pipe(Effect.scoped, Effect.mapError(error => new ConcordError('FixUnverifiable', `Runner preparation failed: ${error.message}`)));
    const cleanupOk = hasConfirmedOwnedGroupCleanup(result);
    if (!cleanupOk) yield* sync(cleanupUnknown);
    if (!cleanupOk || result.exitCode !== 0 || result.timedOut || result.cancelled || result.signal !== null || result.error !== undefined || result.outputLimitExceeded) return yield* Effect.fail(new ConcordError('FixUnverifiable', `Runner preparation command ${index + 1} did not complete successfully`, { command: index + 1, exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, cancelled: result.cancelled, cleanupOk, error: result.error, stdout: result.stdout, stderr: result.stderr }));
  }
});

function assertOutcome(result: CommandEvidence, red: boolean): void {
  if (result.timedOut || !result.cleanupOk || result.cancelled || result.signal !== null || result.commandOutcome === 'invalid' || result.exitCode === null || result.execution === 'none' || result.execution === 'skipped') unavailable('Runner execution timed out, was cancelled, skipped, empty, or cleanup is unconfirmed');
  if (red && result.exitCode === 0) unavailable('Regression tests and the fix were added in the same commit; commit the failing regression test first, then the fix');
  if (!red && result.exitCode !== 0) throw new ConcordError('FixVerificationFailed', 'Runner failed on the accepted fix snapshot');
}

/** Reproduce one frozen runner command from the commits supplied by the caller. */
export const verifyTest = (repo: LocalRepository, testId: string, defectInput: string, fixInput: string) => withRunner(repo, (release, cleanupUnknown) => Effect.gen(function* () {
  const prepared = yield* sync(() => repo.snapshot(() => {
    const fix = resolveCommit(repo.root, fixInput);
    const target = commitRepository(repo, fix);
    return { ...freeze(target, '', defectInput, fix, testId), runnerConfig: requireRunner(target), preparation: commitRepository(repo, resolveCommit(repo.root, 'HEAD')).config.runner };
  }));
  const run = (root: string, red: boolean, preserve: () => void) => Effect.gen(function* () {
    yield* assertFrozenRoot(root, prepared.inputs, 'FixUnverifiable');
    yield* prepareCheckout(root, prepared.preparation, preserve);
    yield* assertFrozenRoot(root, prepared.inputs, 'FixUnverifiable');
    const results = yield* Effect.forEach(prepared.tests, test => executeCommand(root, prepared.runnerConfig, test).pipe(Effect.tap(result => sync(() => { if (!result.cleanupOk) preserve(); assertOutcome(result, red); }))));
    yield* assertFrozenRoot(root, prepared.inputs, 'FixUnverifiable');
    return results;
  });
  const red = yield* inWorktree(repo, prepared.defect, cleanupUnknown, (root, preserve) => run(root, true, preserve));
  const green = yield* inWorktree(repo, prepared.fix, cleanupUnknown, (root, preserve) => run(root, false, preserve));
  yield* sync(release);
  return { operation: 'test-verify', defect: prepared.defect, fix: prepared.fix, tests: prepared.tests.map(test => test.id), runner: prepared.runner, verified: 'replayed' as const, red, green };
})).pipe(Effect.mapError(verificationFailure));

export const closeFixedIssue = (repo: LocalRepository, selector: string, reason: string, defect?: string, fixInput?: string) => withRunner(repo, (release, cleanupUnknown) => Effect.gen(function* () {
  const prepared = yield* sync(() => repo.snapshot(() => {
    const head = resolveCommit(repo.root, 'HEAD');
    const fix = fixInput === undefined ? head : resolveCommit(repo.root, fixInput);
    if (fixInput !== undefined && !git(repo.root, ['rev-list', '--first-parent', head]).split('\n').includes(fix)) unavailable('Fix must be a first-parent ancestor of HEAD');
    const issue = readDocumentSelector(repo, selector, 'issue');
    if (issue.metadata.kind !== 'issue') unavailable('Expected an Issue');
    if (git(repo.root, ['status', '--porcelain=v1', '--untracked-files=all', '--', issue.path])) unavailable('Fix verification requires the Issue file to have no uncommitted changes');
    const targetRepo = commitRepository(repo, fix);
    const issueDigest = digest(snapshotBytes(repo, issue.path)!);
    if (issueDigest !== digest(gitBlobBytes(repo.root, head, issue.path))) unavailable('Issue file differs from the captured HEAD');
    const frozen = freeze(targetRepo, issue.path, defect, fix);
    const testPreimages = [...new Set(frozen.tests.map(test => test.file))].map(path => ({ path, source: repo.read(path) }));
    return { issue, ...frozen, testPreimages, runnerConfig: requireRunner(targetRepo), preparation: commitRepository(repo, head).config.runner, issueDigest };
  }));
  const run = (root: string, red: boolean, preserve: () => void) => Effect.gen(function* () {
    yield* assertFrozenRoot(root, prepared.inputs, 'FixUnverifiable');
    yield* prepareCheckout(root, prepared.preparation, preserve);
    yield* assertFrozenRoot(root, prepared.inputs, 'FixUnverifiable');
    const results = yield* Effect.forEach(prepared.tests, test => executeCommand(root, prepared.runnerConfig, test).pipe(Effect.tap(result => sync(() => { if (!result.cleanupOk) preserve(); assertOutcome(result, red); }))));
    yield* assertFrozenRoot(root, prepared.inputs, 'FixUnverifiable');
    return results;
  });
  const red = yield* inWorktree(repo, prepared.defect, cleanupUnknown, (root, preserve) => run(root, true, preserve));
  const green = yield* inWorktree(repo, prepared.fix, cleanupUnknown, (root, preserve) => run(root, false, preserve));
  const installation = yield* Installation;
  const concord = yield* installation.version;
  const publication = yield* Publication;
  return yield* sync(() => {
    // Publication uses current configuration; runner inputs belong to the captured commit.
    const publisher = new LocalRepository(repo.root, { persistentCache: 'off' }, publication.validation);
    try { return publisher.snapshot(() => {
      const issueBytes = snapshotBytes(publisher, prepared.issue.path);
      if (issueBytes === undefined || digest(issueBytes) !== prepared.issueDigest) throw new ConcordError('FileChangedSinceRead', 'Issue changed during verification');
      for (const file of prepared.testPreimages) if (publisher.read(file.path) !== file.source) throw new ConcordError('FileChangedSinceRead', `${file.path} changed during verification`);
      const verification: Verification = { defect: prepared.defect, fix: prepared.fix, tests: prepared.tests.map(test => test.id) as [string, ...string[]], runner: prepared.runner, concord };
      release();
      const receipt = closeIssue(publisher, prepared.issue.path, reason);
      const conclusion = `Verified fix — ${prepared.issue.path}\nDefect: ${verification.defect} (runner exit ${red[0]?.exitCode})\nFix: ${verification.fix} (runner exit 0)\nTests: ${verification.tests.join(', ')}\nRunner: ${verification.runner}\nClosed ${prepared.issue.path}\nReason: ${reason}\n\nPut the lines above in your commit message.`;
      return { ...receipt, conclusion, verification, red, green };
    }); } finally { publisher.close(); }
  });
})).pipe(Effect.mapError(verificationFailure));
