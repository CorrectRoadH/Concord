// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#修复核验
// @concord-implements docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md
import { Sources, snapshotBytes } from '../../base/sources/index.ts';
import { genericPrivateDirectorySync, registerRunnerWorktree, Publication } from '../../base/publication/index.ts';
import { Installation } from "../../base/installation/index.ts";
import { dirname, join } from "node:path";

import { Effect } from "effect";
import { scanAnnotations, testDeclarationBodies } from "./annotations.ts";
import { readDocumentSelector } from "../documents/index.ts";
import { closeIssue } from "../issues/index.ts";
import { executeCommand, requireRunner, runCase, withRunner } from "./evidence.ts";
import { processDiagnostic, runTestProcess, VerificationProcessGuard, type ProcessDiagnostic, safeRunnerEnvironment } from "../../base/process/index.ts";
import type { Evidence } from "../../model/index.ts";
import { OwnedProcess } from "../../base/process/index.ts";
import { runOwnedProcess, hasConfirmedOwnedGroupCleanup } from "../../base/process/index.ts";
import { LocalRepository, discoverRoot, git, parseTypeScriptConfig } from "../../base/workspace/index.ts";
import { ConcordError, canonical, digest, failure, objectDigest, type AnnotatedCase, type Repository, type FixVerificationSchema, type ProjectConfig, type Runner } from "../../model/index.ts";
import { captureVerificationSnapshot, deriveVerificationRed, dependencyProcessGuard, assertDependencyLocks, commitRepository, firstParentPath, gitBlobBytes, resolveCommit, linkWorktreeDependencies } from "../../base/git/index.ts";

import { PersistentCache } from '../../base/cache/index.ts';
import { RuntimeEnvironment } from '../../base/environment/index.ts';
import { adapterFor } from './test-adapters.ts';

type Verification = typeof FixVerificationSchema.Type;
const sync = <A>(f: () => A | Promise<A>) => Effect.tryPromise({ try: async () => await f(), catch: failure }).pipe(Effect.uninterruptible);
function unavailable(message: string): never { throw new ConcordError('FixUnverifiable', message); }

const verificationFailure = (error: ConcordError): ConcordError => ['InvalidData', 'GitFailed', 'InvalidFile', 'OperationFailed', 'InvalidRunner', 'CleanupFailed', 'CleanupUnknown'].includes(error.code) ? new ConcordError('FixUnverifiable', error.message, error.details) : error;

async function selectedTests(repo: Repository, issue: string, testId?: string): Promise<readonly AnnotatedCase[]> {
  const scan = (await scanAnnotations(repo, { cache: 'off', sourceMode: 'overlay' }));
  if (scan.findings.length) unavailable('Test markers cannot be decoded');
  const tests = scan.cases.filter(test => test.status === 'active' && !test.skipped && (testId === undefined ? test.issues.includes(issue) : test.id === testId)).sort((a, b) => a.id.localeCompare(b.id));
  if (!tests.length) unavailable(`No runnable @issue markers reference ${issue}`);
  return tests;
}
function configurationWithoutPreparation(config: ProjectConfig): ProjectConfig {
  if (config.runner === undefined) return config;
  const { prepare: _prepare, sourceFiles: _sourceFiles, ...runner } = config.runner as unknown as { prepare?: unknown; sourceFiles?: unknown; [key: string]: unknown };
  return { ...config, runner: runner as Runner };
}
function frozenInputs(repo: Repository, tests: readonly AnnotatedCase[], commit: string | undefined, environment: Readonly<Record<string, string | undefined>>) {
  const paths = [...new Set([...tests.map(test => test.file), ...(tests.some(test => !adapterFor(repo, test.file)) ? (requireRunner(repo).sourceFiles ?? []) : repo.config.runner?.sourceFiles ?? []), ...tests.map(test => test.contract.split('#')[0]!)])].filter(path => path !== repo.configSnapshot.path).sort();
  return { runner: objectDigest(configurationWithoutPreparation(repo.configSnapshot.config)), configuration: repo.configSnapshot.path, tests: tests.map(test => test.id), files: paths.map(path => {
    const source = repo.read(path); if (source === undefined) unavailable(`Frozen runner input is unavailable: ${path}`);
    return { path, digest: digest(commit === undefined ? snapshotBytes(repo, path)! : gitBlobBytes(repo.root, commit, path, environment)) };
  }) };
}
async function changedTests(repo: Repository, base: Repository): Promise<readonly AnnotatedCase[]> {
  const scan = await scanAnnotations(repo, { cache: 'off', sourceMode: 'overlay' });
  if (scan.findings.length) unavailable('Test markers cannot be decoded');
  const selected: AnnotatedCase[] = [];
  for (const file of new Set(scan.cases.map(test => test.file))) {
    const current = await testDeclarationBodies(file, repo.read(file)!);
    const previous = await testDeclarationBodies(file, base.read(file) ?? '');
    if (previous.findings.length) unavailable(`Base test markers cannot be decoded: ${file}`);
    for (const test of current.cases) {
      if (test.status === 'active' && !test.skipped && (!previous.bodies.has(test.id) || current.bodies.get(test.id) !== previous.bodies.get(test.id))) selected.push(test);
    }
  }
  if (!selected.length) unavailable('No new or changed test cases in the staged changes');
  return selected.sort((left, right) => left.id.localeCompare(right.id));
}
async function freezeDerived(repo: Repository, capture: ReturnType<typeof captureVerificationSnapshot>, tests: readonly AnnotatedCase[], environment: Readonly<Record<string, string | undefined>>) {
  const snapshots = deriveVerificationRed(repo.root, capture, repo.config.testRoots, environment);
  const inputs = frozenInputs(repo, tests, snapshots.greenCommit, environment);
  const red = await commitRepository(repo, snapshots.redCommit, environment);
  const declaredLocks = tests.flatMap(test => adapterFor(repo, test.file)?.lockFiles ?? []);
  const base = await commitRepository(repo, snapshots.base, environment);
  assertDependencyLocks(base, snapshots.base, declaredLocks, environment);
  assertDependencyLocks(repo, snapshots.greenCommit, declaredLocks, environment);
  assertDependencyLocks(red, snapshots.redCommit, declaredLocks, environment);
  const scan = await scanAnnotations(red, { cache: 'off', sourceMode: 'overlay' });
  if (scan.findings.length || !tests.every(test => scan.cases.some(item => item.id === test.id && item.status === 'active' && !item.skipped))) unavailable('Selected tests are unavailable in the derived red snapshot');
  if (canonical(frozenInputs(red, tests, snapshots.redCommit, environment)) !== canonical(inputs)) unavailable('Frozen tests, runner inputs, or referenced Spec differ between the derived snapshots');
  return { ...snapshots, tests, inputs, defect: snapshots.redCommit, fix: snapshots.greenCommit, runner: inputs.runner, nativeTests: tests.filter(test => adapterFor(repo, test.file)).map(test => test.id) };
}
async function freeze(repo: Repository, issue: string, defectInput: string | undefined, fix: string, testId: string | undefined, environment: Readonly<Record<string, string | undefined>>, deriveCombined = false) {
  const tests = (await selectedTests(repo, issue, testId));
  const inputs = frozenInputs(repo, tests, fix, environment);
  let defect: string;
  if (defectInput) defect = resolveCommit(repo.root, defectInput, 'FixUnverifiable', environment);
  else {
    if (git(repo.root, ['rev-parse', '--is-shallow-repository'], environment) === 'true') unavailable('A shallow clone cannot establish the first regression commit');
    const history = git(repo.root, ['rev-list', '--first-parent', '--reverse', fix], environment).split('\n');
    const first = new Map<string, string>();
    for (const commit of history) {
      if (!git(repo.root, ['ls-tree', '-r', '--name-only', commit, '--', ...tests.map(test => test.file)], environment)) continue;
      const historical = await commitRepository(repo, commit, environment);
      const scan = (await scanAnnotations(historical, { cache: 'off', sourceMode: 'overlay' }));
      for (const test of scan.cases) if (tests.some(selected => selected.id === test.id) && test.issues.includes(issue) && !first.has(test.id)) first.set(test.id, commit);
      if (first.size === tests.length) break;
    }
    const commits = new Set(first.values());
    if (first.size !== tests.length || commits.size !== 1) unavailable('Regression tests first appeared in different commits; provide --defect');
    defect = [...commits][0]!;
  }
  if (deriveCombined && defect === fix) return await freezeDerived(repo, captureVerificationSnapshot(repo.root, environment, fix), tests, environment);
  const interval = firstParentPath(repo.root, defect, fix, environment);
  if (interval.length < 2) unavailable('Fix must be after the defect commit');
  for (const commit of interval) {
    const historical = await commitRepository(repo, commit, environment);
    if (commit === defect || commit === fix) assertDependencyLocks(historical, commit, tests.flatMap(test => adapterFor(repo, test.file)?.lockFiles ?? []), environment);
    const historicTests = (await selectedTests(historical, issue, testId));
    if (canonical(frozenInputs(historical, historicTests, commit, environment)) !== canonical(inputs)) unavailable(`Frozen tests, runner inputs, or referenced Spec changed in ${commit}`);
  }
  return { base: undefined, redTree: undefined, greenTree: undefined, tests, inputs, defect, fix, runner: inputs.runner, nativeTests: tests.filter(test => adapterFor(repo, test.file)).map(test => test.id) };
}
const inWorktree = <A>(repo: Pick<Repository, 'root'>, commit: string, role: 'defect' | 'fix', cleanupUnknown: () => void, run: (root: string, preserve: () => void) => Effect.Effect<A, ConcordError, OwnedProcess | Publication | Sources | Installation>): Effect.Effect<A, ConcordError, OwnedProcess | Publication | Sources | Installation> => Effect.scoped(Effect.gen(function* () {
  const environment = (yield* OwnedProcess).environment.env;
  const invoke = (args: readonly string[]) => runOwnedProcess(['git', '-C', repo.root, '-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo.root, env: safeRunnerEnvironment(environment), timeoutMs: 10000 }).pipe(Effect.scoped, Effect.mapError(failure), Effect.flatMap(result => sync(() => {
    if (!hasConfirmedOwnedGroupCleanup(result)) preserve();
    if (result.exitCode !== 0 || result.timedOut || result.cancelled || result.signal !== null || result.error || !hasConfirmedOwnedGroupCleanup(result)) unavailable('Could not create or clean the verification worktree');
  })));
  const publication = yield* Publication;
  const scratch = yield* publication.scratchDirectory(repo.root, '', 'concord-verify-', 'temporary');
  let preserved = false;
  const preserve = () => { if (!preserved) { preserved = true; scratch.preserve(); cleanupUnknown(); } };
  const root = yield* Effect.acquireRelease(Effect.succeed(join(scratch.path, 'worktree')), root => Effect.gen(function* () {
    if (preserved) return;
    const registered = yield* sync(() => git(repo.root, ['worktree', 'list', '--porcelain'], environment).split('\n').includes(`worktree ${root}`));
    if (registered) yield* invoke(['worktree', 'remove', '--force', root]);
    yield* scratch.remove;
    yield* Effect.scoped(Effect.gen(function* () {
      yield* publication.lease(repo.root, 'test-worktree-release');
      yield* sync(() => registerRunnerWorktree(repo.root, root, false, environment));
    }));
  }).pipe(Effect.catch(error => Effect.sync(() => { preserve(); throw new ConcordError('FixUnverifiable', `Verification worktree cleanup is unconfirmed: ${root}`, error); })), Effect.orDie));
  yield* Effect.scoped(Effect.gen(function* () {
    yield* publication.lease(repo.root, 'test-worktree-register');
    yield* sync(() => registerRunnerWorktree(repo.root, root, true, environment));
  }));
  yield* invoke(['worktree', 'add', '--detach', root, commit]);
  const dependencies = yield* sync(() => linkWorktreeDependencies(repo.root, root, environment));
  return yield* run(root, preserve).pipe(Effect.provideService(VerificationProcessGuard, dependencyProcessGuard(dependencies)), Effect.mapError(error => {
    if (typeof error.details !== 'object' || error.details === null || !('process' in error.details)) return error;
    const details = error.details as { process: ProcessDiagnostic };
    return new ConcordError(error.code, error.message, { ...details, process: { ...details.process, commit: `${role} ${commit}` } });
  }));
}));

const assertFrozenRoot = Effect.fn('fixVerification.assertFrozenRoot')(function*(root: string, inputs: ReturnType<typeof frozenInputs>, code: string) {
  const sources = yield* Sources;
  const config = yield* sources.readAt(root, inputs.configuration).pipe(Effect.mapError(error => new ConcordError(code, error.message)));
  const configDigest = yield* sync(async () => objectDigest(configurationWithoutPreparation(config === undefined ? {} : (await parseTypeScriptConfig(config, inputs.configuration)))));
  if (configDigest !== inputs.runner) return yield* Effect.fail(new ConcordError(code, `Materialized project configuration changed: ${inputs.configuration}`));
  for (const file of inputs.files) {
    const bytes = yield* sources.readBytesAt(root, file.path).pipe(Effect.mapError(error => new ConcordError(code, error.message.includes('Symbolic') ? `Frozen input became a symbolic link: ${file.path}` : `Materialized frozen input is unavailable: ${file.path}`)));
    if (bytes === undefined || digest(bytes) !== file.digest) return yield* Effect.fail(new ConcordError(code, `Materialized frozen input changed: ${file.path}`));
  }
});

const prepareCheckout = Effect.fn('fixVerification.prepare')(function*(root: string, runner: Runner | undefined, cleanupUnknown: () => void) {
  if (runner === undefined || runner.prepare === undefined || runner.prepare.length === 0) return;
  const environment = (yield* OwnedProcess).environment.env;
  for (const [index, argv] of runner.prepare.entries()) {
    const result = yield* runTestProcess(argv, { cwd: root, env: safeRunnerEnvironment(environment), timeoutMs: runner.timeoutMs }, root, `runner preparation ${index + 1}`).pipe(Effect.scoped, Effect.mapError(error => error.code === 'DependenciesModified' ? error : new ConcordError('FixUnverifiable', `Runner preparation failed: ${error.message}`, error.details)));
    const cleanupOk = hasConfirmedOwnedGroupCleanup(result);
    if (!cleanupOk) yield* sync(cleanupUnknown);
    if (!cleanupOk || result.exitCode !== 0 || result.timedOut || result.cancelled || result.signal !== null || result.error !== undefined || result.outputLimitExceeded) return yield* Effect.fail(new ConcordError('FixUnverifiable', `Runner preparation command ${index + 1} did not complete successfully`, { process: processDiagnostic(result, root, root, `runner preparation ${index + 1}`) }));
  }
});

function assertOutcome(result: Evidence, red: boolean, process: ProcessDiagnostic | undefined, derived: boolean): void {
  const details = process === undefined ? undefined : { process };
  if (result.timedOut || !result.cleanupOk || result.cancelled || result.signal !== null || result.commandOutcome === 'invalid' || result.exitCode === null || result.execution === 'none' || result.execution === 'skipped') { throw new ConcordError('FixUnverifiable', 'Runner execution timed out, was cancelled, skipped, empty, or cleanup is unconfirmed', details); }
  if (red && result.exitCode === 0) throw new ConcordError('FixUnverifiable', derived ? 'Selected test passed on the red snapshot; ensure it guards the fix and its test helpers are inside testRoots' : 'Regression tests and the fix were added in the same commit; commit the failing regression test first, then the fix', details);
  if (!red && result.exitCode !== 0) throw new ConcordError('FixVerificationFailed', 'Runner failed on the accepted fix snapshot', details);
}

const executeFrozenCase = Effect.fn('fixVerification.executeFrozenCase')(function*(root: string, runner: Runner | undefined, test: AnnotatedCase, native: boolean, observe: (process: ProcessDiagnostic) => void) {
  if (!native) return yield* executeCommand(root, runner!, test, observe);
  const runtime = (yield* OwnedProcess).environment;
  const publication = yield* Publication;
  const checkout = yield* Effect.acquireRelease(sync(() => LocalRepository.open(root, { persistentCache: 'use', runtime }, publication.validation)), repo => Effect.sync(() => repo.close()));
  yield* Effect.flatMap(PersistentCache, cache => cache.attach(checkout)).pipe(Effect.provide(PersistentCache.layer), Effect.provide(RuntimeEnvironment.layer(runtime)), Effect.mapError(failure));
  return yield* runCase(checkout, test, [], { requireNative: true, observeProcess: observe }).pipe(Effect.mapError(error => error.code === 'DependenciesModified' ? error : new ConcordError('FixUnverifiable', error.message, error.details)));
}, Effect.scoped);

interface FrozenExecution {
  readonly base: string | undefined;
  readonly inputs: ReturnType<typeof frozenInputs>;
  readonly tests: readonly AnnotatedCase[];
  readonly runnerConfig: Runner | undefined;
  readonly preparation: Runner | undefined;
  readonly nativeTests: readonly string[];
  readonly defect: string;
  readonly fix: string;
}
const runFrozenSnapshots = Effect.fn('fixVerification.runSnapshots')(function*(repo: Pick<Repository, 'root'>, prepared: FrozenExecution, cleanupUnknown: () => void) {
  const run = (root: string, red: boolean, preserve: () => void) => Effect.gen(function* () {
    yield* assertFrozenRoot(root, prepared.inputs, 'FixUnverifiable');
    yield* prepareCheckout(root, prepared.preparation, preserve);
    yield* assertFrozenRoot(root, prepared.inputs, 'FixUnverifiable');
    const files = new Set<string>();
    const units = prepared.tests.filter(test => {
      if (prepared.base === undefined || prepared.nativeTests.includes(test.id) || test.named) return true;
      if (files.has(test.file)) return false;
      files.add(test.file); return true;
    });
    const results = yield* Effect.forEach(units, test => {
      let diagnostic: ProcessDiagnostic | undefined;
      return executeFrozenCase(root, prepared.runnerConfig, test, prepared.nativeTests.includes(test.id), process => { if (diagnostic === undefined || process.exitCode !== 0 || process.signal || process.timedOut) diagnostic = process; }).pipe(Effect.tap(result => sync(() => { if (!result.cleanupOk) preserve(); assertOutcome(result, red, diagnostic, prepared.base !== undefined); })), Effect.map(result => prepared.base === undefined ? result : { ...result, scope: prepared.nativeTests.includes(test.id) || test.named ? 'case' as const : 'file' as const }));
    });
    yield* assertFrozenRoot(root, prepared.inputs, 'FixUnverifiable');
    return results;
  });
  const red = yield* inWorktree(repo, prepared.defect, 'defect', cleanupUnknown, (root, preserve) => run(root, true, preserve));
  const green = yield* inWorktree(repo, prepared.fix, 'fix', cleanupUnknown, (root, preserve) => run(root, false, preserve));
  return { red, green };
});

// @concord-begin
// @concord-implements docs/feature/local-sdlc/use-case/verify-fix-in-one-commit.md
export const verifyChanges = Effect.fn('fixVerification.verifyChanges')(function*(root: string, revision?: string) {
  const runtime = (yield* OwnedProcess).environment;
  const environment = runtime.env;
  const repo = yield* sync(() => {
    const selected = discoverRoot(root, false, runtime);
    if (git(selected, ['rev-parse', '--show-toplevel'], environment) !== selected) unavailable('Verification root must be the Git worktree root');
    return { root: selected, privateDir: genericPrivateDirectorySync(selected, environment) };
  });
  return yield* withRunner(repo.root, (release, cleanupUnknown) => Effect.gen(function* () {
    const prepared = yield* sync(async () => {
      const capture = captureVerificationSnapshot(repo.root, environment, revision);
      const target = await commitRepository(repo, capture.greenCommit, environment);
      const base = await commitRepository(repo, capture.base, environment);
      const tests = await changedTests(target, base);
      return { ...await freezeDerived(target, capture, tests, environment), runnerConfig: target.config.runner, preparation: target.config.runner };
    });
    const { red, green } = yield* runFrozenSnapshots(repo, prepared, cleanupUnknown);
    yield* sync(release);
    const tests = prepared.tests.map(test => test.id);
    const conclusion = `Verified fix — ${revision === undefined ? `staged changes on ${prepared.base}` : `commit ${prepared.fix}`}\nRed: ${prepared.base} + ${revision === undefined ? 'staged' : 'fix'} tests (tree ${prepared.redTree}, runner exit ${red[0]?.exitCode})\nGreen: ${revision === undefined ? 'staged tree' : 'tree'} ${prepared.greenTree} (runner exit 0)\nTests: ${tests.join(', ')}\nRunner: ${prepared.runner}\n\nPut the lines above in your commit message.`;
    return { operation: 'test-verify', base: prepared.base, redTree: prepared.redTree, greenTree: prepared.greenTree, tests, runner: prepared.runner, red, green, conclusion };
  }));
}, Effect.mapError(verificationFailure));
// @concord-end

/** Reproduce one frozen runner command from the commits supplied by the caller. */
export const verifyTest = (repo: LocalRepository, testId: string, defectInput: string, fixInput: string) => withRunner(repo, (release, cleanupUnknown) => Effect.gen(function* () {
  const runtime = (yield* OwnedProcess).environment;
  const environment = runtime.env;
  const prepared = yield* sync(async () => (await repo.snapshot(async () => {
    const fix = resolveCommit(repo.root, fixInput, 'FixUnverifiable', environment);
    const target = await commitRepository(repo, fix, environment);
    return { ...(await freeze(target, '', defectInput, fix, testId, environment)), runnerConfig: target.config.runner, preparation: (await commitRepository(repo, resolveCommit(repo.root, 'HEAD', 'FixUnverifiable', environment), environment)).config.runner };
  })));
  const { red, green } = yield* runFrozenSnapshots(repo, prepared, cleanupUnknown);
  yield* sync(release);
  return { operation: 'test-verify', defect: prepared.defect, fix: prepared.fix, tests: prepared.tests.map(test => test.id), runner: prepared.runner, verified: 'replayed' as const, red, green };
})).pipe(Effect.mapError(verificationFailure));

export const closeFixedIssue = (repo: LocalRepository, selector: string, reason: string, defect?: string, fixInput?: string) => withRunner(repo, (release, cleanupUnknown) => Effect.gen(function* () {
  const runtime = (yield* OwnedProcess).environment;
  const environment = runtime.env;
  const prepared = yield* sync(async () => (await repo.snapshot(async () => {
    const head = resolveCommit(repo.root, 'HEAD', 'FixUnverifiable', environment);
    const fix = fixInput === undefined ? head : resolveCommit(repo.root, fixInput, 'FixUnverifiable', environment);
    if (fixInput !== undefined && !git(repo.root, ['rev-list', '--first-parent', head], environment).split('\n').includes(fix)) unavailable('Fix must be a first-parent ancestor of HEAD');
    const issue = readDocumentSelector(repo, selector, 'issue');
    if (issue.metadata.kind !== 'issue') unavailable('Expected an Issue');
    if (git(repo.root, ['status', '--porcelain=v1', '--untracked-files=all', '--', issue.path], environment)) unavailable('Fix verification requires the Issue file to have no uncommitted changes');
    const targetRepo = await commitRepository(repo, fix, environment);
    const issueDigest = digest(snapshotBytes(repo, issue.path)!);
    if (issueDigest !== digest(gitBlobBytes(repo.root, head, issue.path, environment))) unavailable('Issue file differs from the captured HEAD');
    const frozen = (await freeze(targetRepo, issue.path, defect, fix, undefined, environment, true));
    const testPreimages = [...new Set(frozen.tests.map(test => test.file))].map(path => ({ path, source: repo.read(path) }));
    return { issue, ...frozen, testPreimages, runnerConfig: targetRepo.config.runner, preparation: (await commitRepository(repo, head, environment)).config.runner, issueDigest };
  })));
  const { red, green } = yield* runFrozenSnapshots(repo, prepared, cleanupUnknown);
  const installation = yield* Installation;
  const concord = yield* installation.version;
  const publication = yield* Publication;
  return yield* sync(async () => {
    // Publication uses current configuration; runner inputs belong to the captured commit.
    const publisher = await LocalRepository.open(repo.root, { persistentCache: 'off', runtime }, publication.validation);
    try { return (await publisher.snapshot(async () => {
      const issueBytes = snapshotBytes(publisher, prepared.issue.path);
      if (issueBytes === undefined || digest(issueBytes) !== prepared.issueDigest) throw new ConcordError('FileChangedSinceRead', 'Issue changed during verification');
      for (const file of prepared.testPreimages) if (publisher.read(file.path) !== file.source) throw new ConcordError('FileChangedSinceRead', `${file.path} changed during verification`);
      const verification: Verification = { defect: prepared.defect, fix: prepared.fix, tests: prepared.tests.map(test => test.id) as [string, ...string[]], runner: prepared.runner, concord };
      release();
      const verifiedSources = new Map(prepared.testPreimages.map(file => [file.path, file.source]));
      verifiedSources.set(prepared.issue.path, publisher.read(prepared.issue.path));
      const receipt = (await closeIssue(publisher, prepared.issue.path, reason, false, verifiedSources));
      const conclusion = `Verified fix — ${prepared.issue.path}\n${prepared.base === undefined ? `Defect: ${verification.defect} (runner exit ${red[0]?.exitCode})` : `Red: ${prepared.base} + fix tests (tree ${prepared.redTree}, runner exit ${red[0]?.exitCode})`}\nFix: ${verification.fix} (runner exit 0)\nTests: ${verification.tests.join(', ')}\nRunner: ${verification.runner}\nClosed ${prepared.issue.path}\nReason: ${reason}\n\nPut the lines above in your commit message.`;
      return { ...receipt, conclusion, verification, ...(prepared.base === undefined ? {} : { base: prepared.base, redTree: prepared.redTree, greenTree: prepared.greenTree }), red, green };
    })); } finally { publisher.close(); }
  });
})).pipe(Effect.mapError(verificationFailure));
