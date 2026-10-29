import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Effect, Schema } from 'effect';
import { build } from 'esbuild';
import type { StartupData } from '../src/cli-startup-types.js';

class StartupBuildFailed extends Schema.TaggedError<StartupBuildFailed>()('StartupBuildFailed', { message: Schema.String }) {}
const Receipt = Schema.Struct({ stdout: Schema.String, stderr: Schema.String, status: Schema.Int });
const Group = Schema.Struct({ name: Schema.String, description: Schema.optional(Schema.String) });
const Data = Schema.Struct({
  format: Schema.Literal('concord.startup/v1'), packageDigest: Schema.String,
  files: Schema.Record(Schema.String, Schema.String), sourceFiles: Schema.Record(Schema.String, Schema.String),
  receipts: Schema.Record(Schema.String, Receipt), groups: Schema.Array(Group),
});
interface Definition { readonly name: string; readonly description?: string; readonly subcommands: readonly { readonly commands: readonly Definition[] }[] }
const digest = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
const environment: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', TERM: 'dumb', NODE_OPTIONS: '', NODE_DISABLE_COMPILE_CACHE: '1' };
delete environment.FORCE_COLOR;

const capture = (args: readonly string[]) => Effect.tryPromise({
  try: () => new Promise<Schema.Schema.Type<typeof Receipt>>((accept, reject) => {
    execFile(process.execPath, [resolve('dist/entry-full.js'), ...args], { env: environment, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') { reject(error); return; }
      accept(Schema.decodeUnknownSync(Receipt, { onExcessProperty: 'error' })({ stdout, stderr, status: error?.code ?? 0 }));
    });
  }),
  catch: cause => new StartupBuildFailed({ message: `${args.join(' ')}: ${String(cause)}` }),
});

export const buildStartup = Effect.fn('build.startup')(function*() {
  // Keep a self-contained application fallback, independent of command chunks.
  // Package dependencies remain external to preserve Effect service identity with
  // repository contributions and all public exports. The bundle stays at dist's
  // root, preserving every source module's import.meta.url resource base.
  yield* Effect.tryPromise(() => build({ entryPoints: ['dist/cli-fallback.js'], outfile: 'dist/cli-fallback-bundle.js', bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24', sourcemap: true }));
  const definitions = yield* Effect.tryPromise(async () => {
    const file = './dist/cli-full.js';
    const { fullCommand } = await import(pathToFileURL(resolve(file)).href) as { fullCommand: Definition };
    // Read the real repository entry's constructed definition without running it.
    // The temporary sibling preserves its relative imports and resource URLs.
    const repository = readFileSync('dist/repository/cli.js', 'utf8');
    const start = repository.lastIndexOf('runComposedCli(root,');
    if (start < 0) throw new StartupBuildFailed({ message: 'Cannot inspect the repository CLI definition' });
    const inspection = 'dist/repository/cli-startup-inspect.js';
    writeFileSync(inspection, repository.slice(0, start) + '\nexport { root };\n');
    try {
      const { root } = await import(pathToFileURL(resolve(inspection)).href) as { root: Definition };
      return { fullCommand, repositoryCommand: root };
    } finally { unlinkSync(inspection); }
  });
  const paths: string[][] = [];
  const visit = (command: Definition, path: string[]): void => {
    paths.push(path);
    for (const group of command.subcommands) for (const child of group.commands) {
      if (path.length === 0 && child.name === 'repo') visit(definitions.repositoryCommand, ['repo']);
      else visit(child, [...path, child.name]);
    }
  };
  visit(definitions.fullCommand, []);
  const calls = [[], ['--version'], ...paths.map(path => [...path, '--help'])];
  const receipts = yield* Effect.all(calls.map(args => capture(args).pipe(Effect.map(receipt => [JSON.stringify(args), receipt] as const))), { concurrency: 4 });
  yield* Effect.sync(() => {
    const names = readdirSync('src').filter(name => name === 'entry.ts' || name === 'entry-full.ts' || name.startsWith('cli')).sort();
    const files = Object.fromEntries(names.filter(name => name !== 'cli-startup-types.ts').map(name => [`./${name.replace(/\.ts$/u, '.js')}`, digest(`dist/${name.replace(/\.ts$/u, '.js')}`)]));
    const sourceFiles = Object.fromEntries(names.map(name => [`./${name}`, digest(`src/${name}`)]));
    // Repository contributions and their enums also define help. Authenticate
    // those owners so a source edit or mixed installation cannot serve stale
    // repository or Issue/Docs help from an otherwise matching CLI build.
    files['./shared.js'] = digest('dist/shared.js');
    sourceFiles['./shared.ts'] = digest('src/shared.ts');
    for (const file of readdirSync('repository', { recursive: true, encoding: 'utf8' }).filter(name => name.endsWith('.ts') && !name.endsWith('.d.ts')).sort()) {
      const emitted = file.replace(/\.ts$/u, '.js');
      files[`./repository/${emitted}`] = digest(`dist/repository/${emitted}`);
      sourceFiles[`../repository/${file}`] = digest(`repository/${file}`);
    }
    const data: StartupData = Schema.decodeUnknownSync(Data, { onExcessProperty: 'error' })({
      format: 'concord.startup/v1', packageDigest: digest('package.json'), files, sourceFiles,
      receipts: Object.fromEntries(receipts),
      groups: definitions.fullCommand.subcommands.flatMap(group => group.commands.map(command => ({ name: command.name, ...(command.description === undefined ? {} : { description: command.description }) }))),
    });
    writeFileSync('dist/startup-data.js', `// Generated from the complete CLI. Do not edit.\nexport default ${JSON.stringify(data)};\n`);
    console.error(`# Startup: recorded ${paths.length} help paths, version and no-argument output`);
  });
});
