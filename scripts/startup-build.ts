import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Effect, Schema } from 'effect';
import { build } from 'esbuild';
import { API } from 'typescript/sync';
import * as ts from 'typescript/ast';
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

/** Keep the source module's resource and identity owner after code splitting. */
async function bundleCommands(entries: readonly string[], splitting = true): Promise<void> {
  const output = resolve('dist/entry/cli'), model = resolve('dist/model');
  const parser = resolve(model, 'markdown-parser.js');
  const api = new API({ runExternalCode: false });
  try {
    await build({ entryPoints: [...entries], outdir: output, entryNames: '[name]', chunkNames: 'runtime-[hash]',
      bundle: true, splitting, packages: 'external', platform: 'node', format: 'esm', target: 'node24',
      allowOverwrite: true, sourcemap: true, metafile: true, plugins: [{ name: 'source-module-owners', setup(builder) {
        builder.onResolve({ filter: /^\./ }, args => {
          if (!args.importer || !args.path.endsWith('.js')) return;
          const owner = resolve(dirname(args.importer), args.path);
          if (splitting && owner === resolve(output, 'skill.js')) return { path: './skill.js', external: true };
          // Pure model exports can be removed when unused. Keep the actual parser
          // boundary shared with source execution and installed instrumentation.
          if (owner === parser) return { path: relative(output, parser), external: true, sideEffects: false };
          if (owner.startsWith(`${model}/`)) return { path: owner, sideEffects: false };
        });
        builder.onLoad({ filter: /\.js$/ }, args => {
          if (!args.path.startsWith(resolve('dist') + '/')) return;
          const text = readFileSync(args.path, 'utf8');
          const retained = api.createSourceFile(args.path, text, { scriptKind: ts.ScriptKind.JS });
          const edits: { start: number; end: number }[] = [];
          try {
            const source = retained.sourceFile;
            const visit = (node: ts.Node): void => {
              if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.name.text === 'url') {
                edits.push({ start: node.getStart(source), end: node.getEnd() });
              } else node.forEachChild(visit);
            };
            visit(source);
          } finally { retained.dispose(); }
          const owner = relative(output, args.path).replaceAll('\\', '/');
          const location = `new URL(${JSON.stringify(owner.startsWith('.') ? owner : `./${owner}`)}, import.meta.url).href`;
          let contents = text;
          for (const edit of edits.reverse()) contents = contents.slice(0, edit.start) + location + contents.slice(edit.end);
          return { contents, loader: 'js' };
        });
      } }] });
  } finally { api.close(); }
}

export const buildStartup = Effect.fn('build.startup')(function*() {
  // Keep a self-contained application fallback, independent of command chunks.
  // Package dependencies remain external to preserve Effect service identity with
  // repository contributions and all public exports. Installation resources resolve their package owner independently of bundle depth.
  const closure = yield* Effect.tryPromise(() => build({ entryPoints: ['dist/entry/cli/cli-fallback.js'], outfile: 'dist/entry/cli/cli-fallback-bundle.js', metafile: true, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24', sourcemap: true }));
  const roots = ['dist/entry/cli/entry.js', 'dist/entry/cli/entry-full.js', 'dist/entry/cli/cli.js'];
  const bootstrap = yield* Effect.tryPromise(() => build({ entryPoints: roots, outdir: 'dist/startup-graph', write: false, metafile: true, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24' }));
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
  const commands = [...new Set(Object.values(bootstrap.metafile!.inputs).flatMap(input => input.imports)
    .filter(item => item.kind === 'dynamic-import' && item.path.startsWith('dist/entry/cli/')).map(item => item.path))];
  yield* Effect.tryPromise({ try: async () => {
    const skill = 'dist/entry/cli/skill.js';
    await bundleCommands(commands.filter(file => file !== skill));
    await bundleCommands([skill], false);
  }, catch: cause => new StartupBuildFailed({ message: `Bundle command closure: ${String(cause)}` }) });
  const production = yield* Effect.tryPromise(() => build({ entryPoints: [...roots, 'dist/entry/cli/cli-fallback-bundle.js'], outdir: 'dist/startup-graph', write: false, metafile: true, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24' }));
  yield* Effect.sync(() => {
    // esbuild's input graph is the actual command-definition closure, including
    // ordinary imports and finite dynamic chunks, rather than a filename prefix.
    const emitted = [...new Set([...Object.keys(closure.metafile!.inputs), ...Object.keys(bootstrap.metafile!.inputs), ...roots])].filter(file => file.startsWith('dist/') && file.endsWith('.js')).sort();
    const modulePath = (file: string, root: string): string => {
      const path = relative(resolve(root, 'entry/cli'), resolve(file));
      return path.startsWith('.') ? path : `./${path}`;
    };
    const productionFiles = Object.keys(production.metafile!.inputs).filter(file => file.startsWith('dist/') && file.endsWith('.js')).sort();
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
