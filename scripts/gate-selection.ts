// @concord-file
// @concord-implements docs/engineering/testing/cli.md#完整门禁
import { Effect, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { relative, resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseTestDeclarations } from '../src/domain/tests/index.js';
import { codeReferenceTokens } from '../src/domain/code/index.js';
import { withTypeScript } from '../src/base/process/index.js';
import { parseReference, validPackagePath } from '../src/model/index.js';
import { checkoutRoot } from './build-output.js';

export class GateSelectionInvalid extends Schema.TaggedError<GateSelectionInvalid>()('GateSelectionInvalid', {
  detail: Schema.String,
}) {}

const page = (reference: string): string => parseReference(reference).path;
const owner = (path: string): string | undefined => {
  const parts = path.split('/');
  const candidate = [...parts.slice(0, 3), 'README.md'].join('/');
  return validPackagePath('feature', candidate) || validPackagePath('engineering', candidate) ? candidate : undefined;
};

/** Use Cases affect their exact page and whole-package tests; other pages affect their package. */
export function affectedTestContract(changed: string, contract: string): boolean {
  const affected = page(changed), target = page(contract), packageOwner = owner(affected);
  if (packageOwner === undefined || owner(target) !== packageOwner) return false;
  const root = packageOwner.slice(0, -'README.md'.length);
  const useCase = affected.startsWith(`${root}use-case/`) && affected !== `${root}use-case/README.md`;
  return useCase ? target === affected || target === packageOwner : true;
}

/** Normalize only the optional revision; Node's official argument parser owns flag syntax. */
export function gateSelectionArguments(argv: readonly string[]) {
  const normalized: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]!;
    if (value !== '--changed') { normalized.push(value); continue; }
    const next = argv[index + 1];
    const revision = next !== undefined && !next.startsWith('-') && !/\.(?:test|e2e)\.ts$/u.test(next) ? argv[++index]! : '';
    normalized.push(`--changed=${revision}`);
  }
  const parsed = parseArgs({ args: normalized, allowPositionals: true, tokens: true, options: {
    changed: { type: 'string' },
    'test-name-pattern': { type: 'string' }, 'test-shard': { type: 'string' },
    suite: { type: 'string' }, 'node-worker': { type: 'boolean' },
  } });
  if (parsed.tokens.filter(token => token.kind === 'option' && token.name === 'changed').length > 1) {
    throw new GateSelectionInvalid({ detail: '--changed may appear only once' });
  }
  const removed = new Set(parsed.tokens.filter(token => token.kind === 'positional' || token.kind === 'option' && token.name === 'changed').map(token => token.index));
  return { changed: parsed.values.changed, positionals: parsed.positionals, args: normalized.filter((_, index) => !removed.has(index)) };
}

const allTestsDependency = (file: string): boolean => file.startsWith('test/support/') || file.startsWith('scripts/')
  || /(?:^|\/)package\.json$/u.test(file) || /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock)$/u.test(file);

export const selectGateTests = Effect.fn('gate.selectTests')(function*(argv: readonly string[], root = checkoutRoot, output?: string) {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const parsed = yield* Effect.try({ try: () => gateSelectionArguments(argv), catch: cause => new GateSelectionInvalid({ detail: String(cause) }) });
  const absoluteRoot = resolve(root);
  const allFiles = [...new Set((yield* fs.glob('test/**/*.{test,e2e}.ts', { root: absoluteRoot })).map(file => relative(absoluteRoot, resolve(absoluteRoot, file))))].sort();
  const requested = parsed.positionals.map(file => relative(absoluteRoot, resolve(absoluteRoot, file)));
  for (const file of requested) if (!allFiles.includes(file)) return yield* new GateSelectionInvalid({ detail: `Not a current test file: ${file}` });
  const git = Effect.fn('gate.selection.git')(function*(args: readonly string[]) {
    const child = yield* spawner.spawn(ChildProcess.make('git', args, { cwd: absoluteRoot, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }));
    const [stdout, stderr, code] = yield* Effect.all([
      Stream.mkString(Stream.decodeText(child.stdout)), Stream.mkString(Stream.decodeText(child.stderr)), child.exitCode,
    ], { concurrency: 'unbounded' });
    if (Number(code) !== 0) return yield* new GateSelectionInvalid({ detail: `git ${args.join(' ')} exited ${code}: ${stderr.trim()}` });
    return stdout;
  }, Effect.scoped, Effect.mapError(cause => cause instanceof GateSelectionInvalid ? cause : new GateSelectionInvalid({ detail: String(cause) })));
  let base: string | null = null;
  let changedFiles: string[] = [], ignoredFiles: string[] = [], affectedContracts: string[] = [];
  let fullSuiteReason: string | null = null;
  let selected = new Set(allFiles);
  if (parsed.changed !== undefined) {
    base = (yield* git(parsed.changed ? ['rev-parse', '--verify', `${parsed.changed}^{commit}`] : ['merge-base', 'origin/master', 'HEAD'])).trim();
    const tracked = yield* git(['diff', '--no-renames', '--name-only', '-z', base, '--']);
    const untracked = yield* git(['ls-files', '--others', '--exclude-standard', '-z']);
    const differences = [...new Set((tracked + untracked).split('\0').filter(Boolean))].sort();
    ignoredFiles = differences.filter(file => file.startsWith('concord/'));
    changedFiles = differences.filter(file => !file.startsWith('concord/'));
    const broad = changedFiles.find(allTestsDependency);
    if (broad !== undefined) fullSuiteReason = `shared input changed: ${broad}`;
    else {
      const references = new Set(changedFiles.filter(file => file.startsWith('docs/') && file.endsWith('.md')));
      const sourceFiles = changedFiles.filter(file => /\.(?:[cm]?[jt]sx?)$/u.test(file) && !file.startsWith('test/'));
      const oldFiles = new Set(sourceFiles.length === 0 ? [] : (yield* git(['ls-tree', '-r', '--name-only', '-z', base, '--', ...sourceFiles])).split('\0').filter(Boolean));
      const sources: { file: string; text: string }[] = [];
      for (const file of sourceFiles) {
        if (yield* fs.exists(join(absoluteRoot, file))) sources.push({ file, text: yield* fs.readFileString(join(absoluteRoot, file)) });
        if (oldFiles.has(file)) sources.push({ file, text: yield* git(['show', `${base}:${file}`]) });
      }
      yield* Effect.try({ try: () => withTypeScript(() => {
        for (const source of sources) for (const token of codeReferenceTokens(source.file, source.text)) references.add(page(token.reference));
      }), catch: cause => new GateSelectionInvalid({ detail: `Read code associations: ${String(cause)}` }) });
      affectedContracts = [...references].filter(ref => owner(ref) !== undefined).sort();
      selected = new Set(changedFiles.filter(file => allFiles.includes(file)));
      if (affectedContracts.length > 0) {
        const tests = yield* Effect.forEach(allFiles, file => Effect.map(fs.readFileString(join(absoluteRoot, file)), text => ({ file, text })));
        yield* Effect.try({ try: () => withTypeScript(() => {
          for (const source of tests) {
            const markers = parseTestDeclarations(source.file, source.text);
            if (markers.findings.length > 0) throw new GateSelectionInvalid({ detail: `Invalid test markers: ${source.file}` });
            if (markers.cases.some(test => test.status === 'active' && affectedContracts.some(ref => affectedTestContract(ref, test.contract)))) selected.add(source.file);
          }
        }), catch: cause => cause instanceof GateSelectionInvalid ? cause : new GateSelectionInvalid({ detail: String(cause) }) });
      }
    }
  }
  const files = allFiles.filter(file => selected.has(file) && (requested.length === 0 || requested.includes(file)));
  const selection = { mode: parsed.changed === undefined ? requested.length ? 'files' : 'all' : 'changed', base,
    changedFiles, ignoredFiles, affectedContracts, fullSuiteReason, requestedFiles: requested, selectedFiles: files, totalFiles: allFiles.length };
  if (output !== undefined) {
    yield* fs.makeDirectory(output, { recursive: true });
    yield* fs.writeFileString(join(output, 'selection.json'), `${JSON.stringify(selection, null, 2)}\n`);
  }
  return { args: parsed.args, files, allFiles, selection };
});
