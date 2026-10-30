// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#修复核验
// @concord-implements docs/feature/local-sdlc/use-case/resolve-with-command-evidence.md
import { resourcePath } from "../../base/installation/index.js";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { Effect, Schema } from "effect";
import { scanAnnotations } from "./annotations.js";
import { readDocumentSelector } from "../documents/index.js";
import { closeIssue } from "../issues/index.js";
import { executeCommand, requireRunner, withRunner } from "./evidence.js";
import { safeRunnerEnvironment } from "../../base/process/index.js";
import { type CommandEvidence } from "../../model/index.js";
import { OwnedProcess, runOwnedProcess, hasConfirmedOwnedGroupCleanup } from "../../base/process/index.js";
import { LocalRepository, git } from "../../base/workspace/index.js";
import { ConcordError, canonical, digest, failure, objectDigest, type AnnotatedCase, type Repository, type FixVerificationSchema } from "../../model/index.js";
import { commitRepository, firstParentPath, gitBlobBytes, resolveCommit, worktreeIdentity } from "../../base/git/index.js";

type Verification = typeof FixVerificationSchema.Type;
const sync = <A>(f: () => A) => Effect.try({ try: f, catch: failure });
function unavailable(message: string): never { throw new ConcordError('FixUnverifiable', message); }

const verificationFailure = (error: ConcordError): ConcordError => ['InvalidData', 'GitFailed', 'InvalidFile', 'OperationFailed', 'InvalidRunner', 'CleanupFailed', 'CleanupUnknown'].includes(error.code) ? new ConcordError('FixUnverifiable', error.message) : error;

function selectedTests(repo: Repository, issue: string): readonly AnnotatedCase[] {
  const scan = scanAnnotations(repo, { cache: 'off', sourceMode: 'overlay' });
  if (scan.findings.length) unavailable('Test markers cannot be decoded');
  const tests = scan.cases.filter(test => test.status === 'active' && !test.skipped && test.issues.includes(issue)).sort((a, b) => a.id.localeCompare(b.id));
  if (!tests.length) unavailable(`No runnable @issue markers reference ${issue}`);
  return tests;
}
function frozenInputs(repo: Repository, tests: readonly AnnotatedCase[], commit?: string) {
  const paths = [...new Set([repo.configSnapshot.path, ...tests.map(test => test.file), ...requireRunner(repo).sourceFiles, ...tests.map(test => test.contract.split('#')[0]!)])].sort();
  return { runner: objectDigest(repo.config.runner), tests: tests.map(test => test.id), files: paths.map(path => {
    const source = repo.read(path); if (source === undefined) unavailable(`Frozen runner input is unavailable: ${path}`);
    return { path, digest: digest(commit === undefined ? readFileSync(repo.absolute(path)) : gitBlobBytes(repo.root, commit, path)) };
  }) };
}
function freeze(repo: LocalRepository, issue: string, defectInput: string | undefined, fix: string, recorded?: Verification) {
  const tests = selectedTests(repo, issue);
  if (recorded && canonical(recorded.tests.slice().sort()) !== canonical(tests.map(test => test.id))) unavailable('Recorded tests no longer exactly match the Issue markers');
  const inputs = frozenInputs(repo, tests);
  if (recorded && recorded.runner !== inputs.runner) unavailable('Recorded runner configuration no longer matches');
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
  for (const commit of interval) {
    const historical = commitRepository(repo, commit);
    const historicTests = selectedTests(historical, issue);
    if (canonical(frozenInputs(historical, historicTests, commit)) !== canonical(inputs)) unavailable(`Frozen tests, runner inputs, or referenced Spec changed in ${commit}`);
  }
  return { tests, inputs, defect, fix, runner: inputs.runner };
}
function version(): string {
  const path = resourcePath('package.json');
  return Schema.decodeUnknownSync(Schema.Struct({ version: Schema.NonEmptyString }), { onExcessProperty: 'ignore' })(JSON.parse(readFileSync(path, 'utf8')) as unknown).version;
}

const inWorktree = <A>(repo: LocalRepository, issue: string, commit: string, cleanupUnknown: () => void, run: (root: string) => Effect.Effect<A, ConcordError, OwnedProcess>): Effect.Effect<A, ConcordError, OwnedProcess> => Effect.scoped(Effect.gen(function* () {
  const invoke = (args: readonly string[]) => runOwnedProcess(['git', '-C', repo.root, '-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo.root, env: safeRunnerEnvironment(), timeoutMs: 10000 }).pipe(Effect.scoped, Effect.mapError(failure), Effect.flatMap(result => sync(() => {
    if (!hasConfirmedOwnedGroupCleanup(result)) cleanupUnknown();
    if (result.exitCode !== 0 || result.timedOut || result.cancelled || result.signal !== null || result.error || !hasConfirmedOwnedGroupCleanup(result)) unavailable('Could not create or clean the verification worktree');
  })));
  const root = yield* Effect.acquireRelease(sync(() => {
    const directory = join(repo.privateDir, 'verify', issue.split('/').at(-1)!.replace(/\.md$/u, ''));
    for (const path of [repo.privateDir, join(repo.privateDir, 'verify'), directory]) {
      if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new ConcordError('UnsafePath', `Verification directory is a symlink: ${path}`);
      mkdirSync(path, { recursive: true, mode: 0o700 });
    }
    return join(mkdtempSync(join(directory, 'run-')), 'worktree');
  }), root => Effect.gen(function* () {
    const registered = yield* sync(() => git(repo.root, ['worktree', 'list', '--porcelain']).split('\n').includes(`worktree ${root}`));
    if (registered) yield* invoke(['worktree', 'remove', '--force', root]);
    yield* sync(() => rmSync(dirname(root), { recursive: true, force: true }));
  }).pipe(Effect.catch(error => Effect.sync(() => { cleanupUnknown(); throw new ConcordError('FixUnverifiable', `Verification worktree cleanup is unconfirmed: ${root}`, error); })), Effect.orDie));
  yield* invoke(['worktree', 'add', '--detach', root, commit]);
  return yield* run(root);
}));

function assertFrozenRoot(root: string, inputs: ReturnType<typeof frozenInputs>, code: string): void {
  for (const file of inputs.files) {
    const parts = file.path.split('/');
    for (let end = 1; end <= parts.length; end++) if (lstatSync(join(root, ...parts.slice(0, end)), { throwIfNoEntry: false })?.isSymbolicLink()) throw new ConcordError(code, `Frozen input became a symbolic link: ${file.path}`);
    try { if (digest(readFileSync(join(root, file.path))) !== file.digest) throw new ConcordError(code, `Materialized frozen input changed: ${file.path}`); }
    catch (cause) { if (cause instanceof ConcordError) throw cause; throw new ConcordError(code, `Materialized frozen input is unavailable: ${file.path}`); }
  }
}

function assertOutcome(result: CommandEvidence, red: boolean): void {
  if (result.timedOut || !result.cleanupOk || result.cancelled || result.signal !== null || result.commandOutcome === 'invalid' || result.exitCode === null || result.execution === 'zero' || result.execution === 'skipped') unavailable('Runner execution timed out, was cancelled, skipped, empty, or cleanup is unconfirmed');
  if (red && result.exitCode === 0) unavailable('Regression tests and the fix were added in the same commit; commit the failing regression test first, then the fix');
  if (!red && result.exitCode !== 0) throw new ConcordError('FixVerificationFailed', 'Runner failed on the accepted fix snapshot');
}

/** Replay never updates the record. check supplies the current working tree target. */
export const replayFix = (repo: LocalRepository, selector: string, options: { readonly worktree?: boolean } = {}) => withRunner(repo, (release, cleanupUnknown) => Effect.gen(function* () {
  const prepared = yield* sync(() => {
    const issue = readDocumentSelector(repo, selector, 'issue');
    if (issue.metadata.kind !== 'issue' || issue.metadata.closure?.kind !== 'fixed' || !issue.metadata.closure.verification) unavailable('Issue has no recorded fix verification');
    const recorded = issue.metadata.closure.verification;
    const fix = resolveCommit(repo.root, recorded.fix);
    // test verify freezes against F; since freezes against its worktree target.
    const targetRepo = options.worktree ? repo : commitRepository(repo, fix);
    const tests = selectedTests(targetRepo, issue.path);
    if (canonical(tests.map(test => test.id)) !== canonical(recorded.tests.slice().sort()) || objectDigest(targetRepo.config.runner) !== recorded.runner) unavailable('Recorded tests or runner configuration changed');
    const defect = resolveCommit(repo.root, recorded.defect);
    const targetCommit = options.worktree ? resolveCommit(repo.root, 'HEAD') : fix;
    firstParentPath(repo.root, defect, fix);
    if (options.worktree) firstParentPath(repo.root, fix, targetCommit);
    const inputs = frozenInputs(targetRepo, tests, options.worktree ? undefined : fix);
    for (const commit of firstParentPath(repo.root, defect, targetCommit)) {
      const historical = commitRepository(repo, commit);
      if (canonical(frozenInputs(historical, selectedTests(historical, issue.path), commit)) !== canonical(inputs)) unavailable('Frozen runner inputs or referenced Spec changed');
    }
    return { issue, recorded, tests, inputs, runner: requireRunner(targetRepo), identity: worktreeIdentity(repo) };
  });
  const run = (root: string, red: boolean) => Effect.gen(function* () {
    const code = root === repo.root ? 'PreimageChanged' : 'FixUnverifiable';
    yield* sync(() => assertFrozenRoot(root, prepared.inputs, code));
    const results = yield* Effect.forEach(prepared.tests, test => executeCommand(root, prepared.runner, test).pipe(Effect.tap(result => sync(() => assertOutcome(result, red)))));
    yield* sync(() => assertFrozenRoot(root, prepared.inputs, code));
    return results;
  });
  const red = yield* inWorktree(repo, prepared.issue.path, prepared.recorded.defect, cleanupUnknown, root => run(root, true));
  const green = yield* (options.worktree ? run(repo.root, false) : inWorktree(repo, prepared.issue.path, prepared.recorded.fix, cleanupUnknown, root => run(root, false)));
  yield* sync(() => repo.snapshot(() => { if (worktreeIdentity(repo) !== prepared.identity) throw new ConcordError('PreimageChanged', 'Working tree or HEAD changed during verification'); release(); }));
  return { operation: 'test-verify', issue: prepared.issue.path, verification: prepared.recorded, verified: 'replayed' as const, red, green };
})).pipe(Effect.mapError(verificationFailure));

export const closeFixedIssue = (repo: LocalRepository, selector: string, reason: string, defect?: string): Effect.Effect<object, ConcordError, OwnedProcess> => withRunner(repo, (release, cleanupUnknown) => Effect.gen(function* () {
  const prepared = yield* sync(() => repo.snapshot(() => {
    if (git(repo.root, ['status', '--porcelain=v1', '--untracked-files=all'])) unavailable('Fix verification requires a clean working tree');
    const issue = readDocumentSelector(repo, selector, 'issue');
    if (issue.metadata.kind !== 'issue') unavailable('Expected an Issue');
    if (issue.metadata.status !== 'open' && !(issue.metadata.closure?.kind === 'fixed' && !issue.metadata.closure.verification)) throw new ConcordError('InvalidIssueState', 'Issue is already closed');
    const fix = resolveCommit(repo.root, 'HEAD');
    return { issue, ...freeze(repo, issue.path, defect, fix), identity: worktreeIdentity(repo) };
  }));
  const run = (root: string, red: boolean) => Effect.gen(function* () {
    const code = root === repo.root ? 'PreimageChanged' : 'FixUnverifiable';
    yield* sync(() => assertFrozenRoot(root, prepared.inputs, code));
    const results = yield* Effect.forEach(prepared.tests, test => executeCommand(root, requireRunner(repo), test).pipe(Effect.tap(result => sync(() => assertOutcome(result, red)))));
    yield* sync(() => assertFrozenRoot(root, prepared.inputs, code));
    return results;
  });
  const red = yield* inWorktree(repo, prepared.issue.path, prepared.defect, cleanupUnknown, root => run(root, true));
  const green = yield* run(repo.root, false);
  return yield* sync(() => repo.snapshot(() => {
    if (worktreeIdentity(repo) !== prepared.identity || repo.read(prepared.issue.path) === undefined || repo.read(repo.configSnapshot.path) !== repo.configSnapshot.source) throw new ConcordError('PreimageChanged', 'HEAD, working tree, configuration, or Issue changed during verification');
    const verification: Verification = { defect: prepared.defect, fix: prepared.fix, tests: prepared.tests.map(test => test.id) as [string, ...string[]], runner: prepared.runner, concord: version() };
    release();
    const receipt = closeIssue(repo, selector, { kind: 'fixed', reason, verification });
    return { ...receipt, verification, red, green };
  }));
})).pipe(Effect.mapError(verificationFailure));
