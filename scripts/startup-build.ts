import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Effect, Schema } from 'effect';
import { build } from 'esbuild';
import { type StartupData } from "../src/model/index.js";

class StartupBuildFailed extends Schema.TaggedError<StartupBuildFailed>()('StartupBuildFailed', { message: Schema.String }) {}
const Receipt = Schema.Struct({ stdout: Schema.String, stderr: Schema.String, status: Schema.Int });
const Group = Schema.Struct({ name: Schema.String, description: Schema.optional(Schema.String) });
const Data = Schema.Struct({
  format: Schema.Literal('concord.startup/v1'), packageDigest: Schema.String, dataDigest: Schema.String,
  files: Schema.Record(Schema.String, Schema.String), sourceFiles: Schema.Record(Schema.String, Schema.String),
  receipts: Schema.Record(Schema.String, Receipt), groups: Schema.Array(Group),
});
interface Definition { readonly name: string; readonly description?: string; readonly subcommands: readonly { readonly commands: readonly Definition[] }[] }
const digest = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
const environment: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', TERM: 'dumb', NODE_OPTIONS: '', NODE_DISABLE_COMPILE_CACHE: '1' };
delete environment.FORCE_COLOR;

const capture = (args: readonly string[]) => Effect.tryPromise({
  try: () => new Promise<Schema.Schema.Type<typeof Receipt>>((accept, reject) => {
    execFile(process.execPath, [resolve('dist/entry/cli/entry-full.js'), ...args], { env: environment, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') { reject(error); return; }
      accept(Schema.decodeUnknownSync(Receipt, { onExcessProperty: 'error' })({ stdout, stderr, status: error?.code ?? 0 }));
    });
  }),
  catch: cause => new StartupBuildFailed({ message: `${args.join(' ')}: ${String(cause)}` }),
});

export const buildStartup = Effect.fn('build.startup')(function*() {
  // Keep a self-contained application fallback, independent of command chunks.
  // Package dependencies remain external to preserve Effect service identity with
  // repository contributions and all public exports. Installation resources resolve their package owner independently of bundle depth.
  const closure = yield* Effect.tryPromise(() => build({ entryPoints: ['dist/entry/cli/cli-fallback.js'], outfile: 'dist/entry/cli/cli-fallback-bundle.js', metafile: true, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24', sourcemap: true }));
  const bootstrap = yield* Effect.tryPromise(() => build({ entryPoints: ['dist/entry/cli/entry.js', 'dist/entry/cli/entry-full.js', 'dist/entry/cli/cli.js'], outdir: 'dist/startup-graph', write: false, metafile: true, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24' }));
  const definitions = yield* Effect.tryPromise(async () => {
    const file = './dist/entry/cli/cli-full.js';
    const { fullCommand } = await import(pathToFileURL(resolve(file)).href) as { fullCommand: Definition };
    return { fullCommand };
  });
  const paths: string[][] = [];
  const visit = (command: Definition, path: string[]): void => {
    paths.push(path);
    for (const group of command.subcommands) for (const child of group.commands) {
      visit(child, [...path, child.name]);
    }
  };
  visit(definitions.fullCommand, []);
  const calls = [[], ['--version'], ...paths.map(path => [...path, '--help'])];
  const receipts = yield* Effect.all(calls.map(args => capture(args).pipe(Effect.map(receipt => [JSON.stringify(args), receipt] as const))), { concurrency: 4 });
  yield* Effect.sync(() => {
    // esbuild's input graph is the actual command-definition closure, including
    // ordinary imports and finite dynamic chunks, rather than a filename prefix.
    const roots = ['dist/entry/cli/entry.js', 'dist/entry/cli/entry-full.js', 'dist/entry/cli/cli.js'];
    const emitted = [...new Set([...Object.keys(closure.metafile!.inputs), ...Object.keys(bootstrap.metafile!.inputs), ...roots])].filter(file => file.startsWith('dist/') && file.endsWith('.js')).sort();
    const modulePath = (file: string, root: string): string => {
      const path = relative(resolve(root, 'entry/cli'), resolve(file));
      return path.startsWith('.') ? path : `./${path}`;
    };
    const productionFiles = [...emitted, 'dist/entry/cli/cli-fallback-bundle.js'];
    const files = Object.fromEntries(productionFiles.map(file => [modulePath(file, 'dist'), digest(file)]));
    const sourceFiles = Object.fromEntries(emitted.map(file => file.replace(/^dist\//u, 'src/').replace(/\.js$/u, '.ts')).map(file => [modulePath(file, 'src'), digest(file)]));
    const payload = {
      format: 'concord.startup/v1', packageDigest: digest('package.json'), files, sourceFiles,
      receipts: Object.fromEntries(receipts),
      groups: definitions.fullCommand.subcommands.flatMap(group => group.commands.map(command => ({ name: command.name, ...(command.description === undefined ? {} : { description: command.description }) }))),
    };
    const data: StartupData = Schema.decodeUnknownSync(Data, { onExcessProperty: 'error' })({ ...payload, dataDigest: createHash('sha256').update(JSON.stringify(payload)).digest('hex') });
    writeFileSync('dist/startup-data.js', `// Generated from the complete CLI. Do not edit.\nexport default ${JSON.stringify(data)};\n`);
    console.error(`# Startup: recorded ${paths.length} help paths, version and no-argument output`);
  });
});
