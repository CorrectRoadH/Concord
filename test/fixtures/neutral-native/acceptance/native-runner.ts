import { spawnSync, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Schema } from 'effect';
import {
  NativeCaseReceiptSchema,
  NativeReliabilityCertificateSchema,
  evidenceSignature,
} from 'concord-sdlc/evidence-policy';
import { deriveTestReference } from 'concord-sdlc/model';
import { resolveRepositorySourceIdentity } from 'concord-sdlc/repository/source-identity';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testFile = 'acceptance/calculator.test.ts';
const testTitle = 'adds two numbers';
const problem = 'memory/calculator.md';
const caseId = deriveTestReference(testFile, testFile, testTitle);
export const selector = `${testFile}#${caseId}`;

const Nat = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const VitestListSchema = Schema.Array(Schema.Struct({
  name: Schema.String,
  file: Schema.String,
  location: Schema.Struct({ line: Schema.Int, column: Schema.Int })
}));
const AssertionSchema = Schema.Struct({
  fullName: Schema.String,
  status: Schema.Literals(['passed', 'failed', 'pending', 'todo', 'skipped']),
  retryCount: Schema.optional(Nat),
  retryReasons: Schema.optional(Schema.Array(Schema.Unknown))
});
const VitestReportSchema = Schema.Struct({
  numTotalTests: Nat,
  numPassedTests: Nat,
  numFailedTests: Nat,
  numPendingTests: Nat,
  numTodoTests: Nat,
  success: Schema.Boolean,
  testResults: Schema.Array(Schema.Struct({ assertionResults: Schema.Array(AssertionSchema) }))
});
const PackageSchema = Schema.Struct({ version: Schema.String });

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const git = (root: string, args: readonly string[]): string => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const vitestPath = (root: string): string => join(root, 'node_modules/vitest/vitest.mjs');
const vitestVersion = (root: string): string => Schema.decodeUnknownSync(PackageSchema)(readJson(join(root, 'node_modules/vitest/package.json'))).version;

export function implementationDigest(root: string): `sha256:${string}` {
  const files = ['acceptance/host.ts', 'acceptance/native-runner.ts', 'acceptance/record-evidence.ts'];
  const identity = files.map(path => ({ path, sha256: sha256(readFileSync(join(root, path))) }));
  return `sha256:${evidenceSignature(identity)}`;
}

function collectCaseInventory(root: string, suiteId: string, checkout: string) {
  if (suiteId !== 'calculator') throw new Error(`unknown suite ${suiteId}`);
  const bodySentinel = join(root, '.repo-tools/neutral-native/inventory-body-executed');
  const setupSentinel = join(root, '.repo-tools/neutral-native/inventory-setup-executed');
  mkdirSync(dirname(bodySentinel), { recursive: true });
  rmSync(bodySentinel, { force: true });
  rmSync(setupSentinel, { force: true });
  const argv = ['list', '--root', root, '--json', '--staticParse', testFile];
  const result = spawnSync(process.execPath, [vitestPath(root), ...argv], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, NEUTRAL_NATIVE_BODY_SENTINEL: bodySentinel, NEUTRAL_NATIVE_SETUP_SENTINEL: setupSentinel }
  });
  if (result.error !== undefined || result.status !== 0 || result.signal !== null) {
    throw new Error(`Vitest static inventory failed: ${String(result.error ?? result.stderr)}`);
  }
  const listed = Schema.decodeUnknownSync(Schema.fromJsonString(VitestListSchema))(result.stdout);
  const cases = listed.map(item => {
    const path = relative(root, item.file).split('\\').join('/');
    if (path !== testFile || item.name !== testTitle) throw new Error(`unexpected native case ${path}#${item.name}`);
    return { executor: 'vitest', repo: suiteId, path, titlePath: [item.name], caseId };
  });
  const unsigned = {
    executor: { name: 'vitest', version: vitestVersion(root) },
    repo: suiteId,
    argv: [process.execPath, vitestPath(root), ...argv],
    checkout,
    files: [...new Set(cases.map(item => item.path))],
    cases,
    unassignedCases: [],
    bodyExecutions: existsSync(bodySentinel) ? 1 : 0,
    forbiddenSetupExecutions: existsSync(setupSentinel) ? 1 : 0,
    findings: [],
    exit: result.status,
    signal: result.signal
  };
  return { ...unsigned, digest: `sha256:${evidenceSignature(unsigned)}` as const };
}

export function collectVitestInventory(root: string, suiteId: string, checkout: string) {
  const receipt = collectCaseInventory(root, suiteId, checkout);
  const unsigned = {
    checkout,
    repos: [{ id: suiteId, receipts: [receipt] }],
    files: receipt.files,
    cases: receipt.cases,
    unassignedCases: [],
    findings: []
  };
  return { ...unsigned, digest: `sha256:${evidenceSignature(unsigned)}` as const };
}

interface NativeMode {
  readonly name: 'single' | 'isolated' | 'same' | 'parallel';
  readonly parallelism: number;
  readonly sequence: number;
}
interface ObservationDraft {
  readonly argv: readonly string[];
  readonly copyId: string;
  readonly copyPath: string;
  readonly mode: NativeMode;
  readonly report: typeof VitestReportSchema.Type;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly startupFailed: boolean;
  readonly bodyExecutions: number;
}

function createCopy(root: string, label: string, candidateRef = 'HEAD'): { readonly copyId: string; readonly copyPath: string } {
  const copies = join(root, '.repo-tools/neutral-native/copies');
  mkdirSync(copies, { recursive: true });
  const copyPath = mkdtempSync(join(copies, `${label}-`));
  mkdirSync(join(copyPath, 'acceptance'));
  mkdirSync(join(copyPath, 'src'));
  cpSync(join(root, testFile), join(copyPath, testFile));
  writeFileSync(join(copyPath, 'src/calculator.ts'), execFileSync('git', ['-C', root, 'show', `${candidateRef}:src/calculator.ts`], { encoding: 'utf8' }));
  return { copyId: basename(copyPath), copyPath };
}

function observe(root: string, copy: { readonly copyId: string; readonly copyPath: string }, mode: NativeMode): ObservationDraft {
  const reportPath = join(copy.copyPath, `.vitest-report-${randomUUID()}.json`);
  const bodySentinel = join(copy.copyPath, `.body-${randomUUID()}.log`);
  const argv = [
    'run', testFile, '--root', copy.copyPath, '--testNamePattern', `^${testTitle}$`,
    '--reporter=json', `--outputFile=${reportPath}`, '--retry=0',
    `--maxWorkers=${mode.parallelism}`,
    ...(mode.name === 'parallel' ? [] : ['--no-file-parallelism'])
  ];
  const result = spawnSync(process.execPath, [vitestPath(root), ...argv], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, NEUTRAL_NATIVE_BODY_SENTINEL: bodySentinel }
  });
  const errorCode = result.error === undefined ? undefined : (result.error as NodeJS.ErrnoException).code;
  if (!existsSync(reportPath)) throw new Error(`Vitest JSON report was not produced: ${String(result.error ?? result.stderr)}`);
  const report = Schema.decodeUnknownSync(VitestReportSchema)(readJson(reportPath));
  const bodyExecutions = existsSync(bodySentinel) ? readFileSync(bodySentinel, 'utf8').split('\n').filter(Boolean).length : 0;
  return {
    argv: [process.execPath, vitestPath(root), ...argv],
    copyId: copy.copyId,
    copyPath: copy.copyPath,
    mode,
    report,
    exitCode: result.status,
    signal: result.signal,
    timedOut: errorCode === 'ETIMEDOUT',
    startupFailed: result.error !== undefined && errorCode !== 'ETIMEDOUT',
    bodyExecutions
  };
}

function cleanup(copyPath: string): boolean {
  rmSync(copyPath, { recursive: true, force: true });
  return !existsSync(copyPath);
}

function candidate(root: string, candidateRef: string) {
  const bytes = execFileSync('git', ['-C', root, 'show', `${candidateRef}:src/calculator.ts`]);
  const hash = createHash('sha256').update(bytes).digest();
  return { gitSha: git(root, ['rev-parse', candidateRef]), sha256: hash.toString('hex'), sri: `sha256-${hash.toString('base64')}` };
}

function receipt(root: string, inventoryDigest: string, epoch: number, candidateRef: string, draft: ObservationDraft, observation: 'red' | 'green' | 'reliability', cleaned: boolean) {
  const assertions = draft.report.testResults.flatMap(result => result.assertionResults);
  const retries = assertions.reduce((count, item) => count + (item.retryCount ?? item.retryReasons?.length ?? 0), 0);
  if (draft.bodyExecutions !== draft.report.numTotalTests) throw new Error('body sentinel disagrees with the Vitest JSON case count');
  const unsigned = {
    format: 'concord.native-case-receipt/v1' as const,
    mode: 'formal' as const,
    observation,
    selector,
    caseId,
    inventoryDigest,
    problem: { path: problem, epoch },
    candidate: candidate(root, candidateRef),
    source: resolveRepositorySourceIdentity(root, selector),
    runner: { executor: 'vitest', version: vitestVersion(root), implementationDigest: implementationDigest(root), argv: draft.argv },
    result: {
      disposition: observation === 'red' ? 'regression' as const : 'pass' as const,
      stage: 'vitest-json-completed',
      exitCode: draft.exitCode,
      signal: draft.signal,
      timedOut: draft.timedOut,
      startupFailed: draft.startupFailed
    },
    native: {
      copyId: draft.copyId,
      copyPath: draft.copyPath,
      sequence: draft.mode.sequence,
      mode: draft.mode.name,
      caseCount: draft.report.numTotalTests,
      passed: draft.report.numPassedTests,
      failed: draft.report.numFailedTests,
      skipped: draft.report.numPendingTests + draft.report.numTodoTests,
      retries,
      parallelism: draft.mode.parallelism
    },
    cleanup: { ok: cleaned, resources: [{ kind: 'directory', path: draft.copyPath, ok: cleaned, gone: cleaned, removed: cleaned }] },
    invocationId: `vitest-${randomUUID()}`
  };
  return Schema.decodeUnknownSync(NativeCaseReceiptSchema)({ ...unsigned, receiptSha256: evidenceSignature(unsigned) });
}

function currentInventory(root: string) {
  return collectCaseInventory(root, 'calculator', git(root, ['rev-parse', 'HEAD']));
}

function writeReceipt(root: string, path: string, value: unknown): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
}

export function recordRed(root: string, epoch: number, defectRef: string): void {
  const inventory = currentInventory(root);
  const copy = createCopy(root, 'red', defectRef);
  const draft = observe(root, copy, { name: 'single', parallelism: 1, sequence: 1 });
  const red = receipt(root, inventory.digest, epoch, defectRef, draft, 'red', cleanup(copy.copyPath));
  if (red.native.failed !== 1 || red.native.passed !== 0 || red.result.exitCode === 0) throw new Error('defect candidate did not produce one ordinary native red');
  writeReceipt(root, '.repo-tools/neutral-native/red.json', red);
}

export function recordTakeover(root: string, epoch: number): void {
  const inventory = currentInventory(root);
  const receiptRoot = '.repo-tools/neutral-native/receipts';
  const paths = {
    green: `${receiptRoot}/green.json`,
    isolated: [1, 2, 3].map(value => `${receiptRoot}/isolated-${value}.json`) as [string, string, string],
    same: [1, 2].map(value => `${receiptRoot}/same-${value}.json`) as [string, string],
    parallel: `${receiptRoot}/parallel.json`
  };
  const greenCopy = createCopy(root, 'green');
  const greenDraft = observe(root, greenCopy, { name: 'single', parallelism: 1, sequence: 1 });
  const green = receipt(root, inventory.digest, epoch, 'HEAD', greenDraft, 'green', cleanup(greenCopy.copyPath));
  writeReceipt(root, paths.green, green);

  const isolated = paths.isolated.map((path, index) => {
    const copy = createCopy(root, `isolated-${index + 1}`);
    const draft = observe(root, copy, { name: 'isolated', parallelism: 1, sequence: 1 });
    const observed = receipt(root, inventory.digest, epoch, 'HEAD', draft, 'reliability', cleanup(copy.copyPath));
    writeReceipt(root, path, observed);
    return observed;
  });

  const sameCopy = createCopy(root, 'same');
  const sameDraftA = observe(root, sameCopy, { name: 'same', parallelism: 1, sequence: 1 });
  const sameDraftB = observe(root, sameCopy, { name: 'same', parallelism: 1, sequence: 2 });
  const sameCleaned = cleanup(sameCopy.copyPath);
  const same = [
    receipt(root, inventory.digest, epoch, 'HEAD', sameDraftA, 'reliability', sameCleaned),
    receipt(root, inventory.digest, epoch, 'HEAD', sameDraftB, 'reliability', sameCleaned)
  ] as const;
  writeReceipt(root, paths.same[0], same[0]);
  writeReceipt(root, paths.same[1], same[1]);

  const parallelCopy = createCopy(root, 'parallel');
  const parallelDraft = observe(root, parallelCopy, { name: 'parallel', parallelism: 2, sequence: 1 });
  const parallel = receipt(root, inventory.digest, epoch, 'HEAD', parallelDraft, 'reliability', cleanup(parallelCopy.copyPath));
  writeReceipt(root, paths.parallel, parallel);

  const receiptPaths = [paths.green, ...paths.isolated, ...paths.same, paths.parallel];
  const certificateUnsigned = {
    format: 'concord.native-reliability/v1' as const,
    selector,
    caseId,
    candidateSha256: green.candidate.sha256,
    sourceDigest: resolveRepositorySourceIdentity(root, selector).projection.digest,
    greenReceipt: paths.green,
    observations: {
      isolatedCopies: paths.isolated,
      sameCopy: paths.same,
      defaultParallel: paths.parallel,
      singleCase: paths.green,
      cleanup: receiptPaths
    }
  };
  const certificate = Schema.decodeUnknownSync(NativeReliabilityCertificateSchema)({
    ...certificateUnsigned,
    certificateSha256: evidenceSignature(certificateUnsigned)
  });
  const all = [green, ...isolated, ...same, parallel];
  if (all.some(item => item.native.failed !== 0 || item.native.passed !== item.native.caseCount || item.result.exitCode !== 0)) {
    throw new Error('fixed candidate did not produce the complete native green matrix');
  }
  writeReceipt(root, '.repo-tools/neutral-native/takeover.json', {
    id: 'takeover-current', certificate, receiptPaths, candidatePath: 'src/calculator.ts'
  });
}
