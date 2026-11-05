import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Console, Effect, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process';
import { build } from 'esbuild';
import { API } from 'typescript/sync';
import * as ts from 'typescript/ast';
import { type StartupData } from "../src/model/index.js";

let distribution: string;
const dist = (path = '') => join(distribution, path);
const insideDist = (file: string) => resolve(file).startsWith(distribution + '/');

class StartupBuildFailed extends Schema.TaggedError<StartupBuildFailed>()('StartupBuildFailed', { message: Schema.String }) {}
const Receipt = Schema.Struct({ stdout: Schema.String, stderr: Schema.String, status: Schema.Int });
const Group = Schema.Struct({ name: Schema.String, description: Schema.optional(Schema.String) });
const Data = Schema.Struct({
  format: Schema.Literal('concord.startup/v1'), packageDigest: Schema.String, dataDigest: Schema.String,
  files: Schema.Record(Schema.String, Schema.String), sourceFiles: Schema.Record(Schema.String, Schema.String),
  receipts: Schema.Record(Schema.String, Receipt), groups: Schema.Array(Group),
});
interface Definition { readonly name: string; readonly description?: string; readonly subcommands: readonly { readonly commands: readonly Definition[] }[] }
const digest = Effect.fn('build.startupDigest')(function*(path: string) {
  const fs = yield* FileSystem.FileSystem;
  return createHash('sha256').update(yield* fs.readFile(path)).digest('hex');
});
const environment: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', TERM: 'dumb', NODE_OPTIONS: '', NODE_DISABLE_COMPILE_CACHE: '1' };
delete environment.FORCE_COLOR;

const capture = Effect.fn('build.captureStartup')(function*(args: readonly string[]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make(process.execPath, [resolve(dist('entry/cli/entry-full.js')), ...args], { env: environment }));
  const collect = (stream: typeof child.stdout) => Effect.suspend(() => {
    let bytes = 0;
    return stream.pipe(Stream.mapEffect(chunk => {
      bytes += chunk.byteLength;
      return bytes > 16 * 1024 * 1024
        ? Effect.fail(new StartupBuildFailed({ message: 'Startup receipt exceeded the 16 MiB output limit' }))
        : Effect.succeed(chunk);
    }), Stream.decodeText(), Stream.mkString);
  });
  const [stdout, stderr, status] = yield* Effect.all([collect(child.stdout), collect(child.stderr), child.exitCode], { concurrency: 'unbounded' });
  return yield* Schema.decodeUnknownEffect(Receipt, { onExcessProperty: 'error' })({ stdout, stderr, status });
}, Effect.scoped, Effect.timeout('30 seconds'), Effect.mapError(cause => new StartupBuildFailed({ message: String(cause) })));

/** Keep the source module's resource and identity owner after code splitting. */
const bundleCommands = Effect.fn('build.bundleCommands')(function*(entries: readonly string[], splitting = true, entryNames = '[name]', chunkNames = 'runtime-[hash]', write = true, directory = dist('entry/cli')) {
  const fs = yield* FileSystem.FileSystem;
  const output = resolve(directory), model = resolve(dist('model'));
  const libraries = ['model', 'base', 'domain', 'app'].map(layer => resolve(dist(), layer) + '/');
  const parser = resolve(model, 'markdown-parser.js');
  const api = yield* Effect.acquireRelease(Effect.sync(() => new API({ runExternalCode: false })), api => Effect.sync(() => api.close()));
  const result = yield* Effect.tryPromise({ try: () => build({ entryPoints: [...entries], outdir: output, entryNames, chunkNames, write,
      bundle: true, splitting, packages: 'external', platform: 'node', format: 'esm', target: 'node24',
      allowOverwrite: true, sourcemap: true, metafile: true, plugins: [{ name: 'source-module-owners', setup(builder) {
        builder.onResolve({ filter: /^\./ }, args => {
          if (!args.importer || !args.path.endsWith('.js')) return;
          const owner = resolve(dirname(args.importer), args.path);
          if (splitting && owner === resolve(output, 'skill.js')) return { path: './skill.js', external: true };
          // Library modules declare models, services and operations; entry roots
          // execute effects. Remove unused libraries while retaining one parser
          // boundary for source execution and installed instrumentation.
          if (owner === parser) return { path: relative(output, parser), external: true, sideEffects: false };
          if (libraries.some(directory => owner.startsWith(directory))) return { path: owner, sideEffects: false };
        });
        builder.onLoad({ filter: /\.js$/ }, async args => {
          if (!args.path.startsWith(resolve(dist()) + '/')) return;
          const text = await Effect.runPromise(fs.readFileString(args.path));
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
      } }] }), catch: cause => new StartupBuildFailed({ message: `Bundle command closure: ${String(cause)}` }) });
  return result.outputFiles;
}, Effect.scoped);

export const buildStartup = Effect.fn('build.startup')(function*(directory: string, packageRoot: string) {
  distribution = resolve(directory);
  const fs = yield* FileSystem.FileSystem;
  // Pure parser and terminal dependencies have no Effect service identities.
  // Keep their module boundaries for source execution and parser probes while
  // avoiding a module-resolution waterfall before the first terminal frame.
  yield* Effect.tryPromise(() => build({ entryPoints: [dist('model/markdown-dependencies.js')], outdir: dist(), outbase: dist(), bundle: true, packages: 'bundle', external: ['effect', 'effect/*', '@effect/*'], platform: 'node', format: 'esm', target: 'node24', allowOverwrite: true, sourcemap: true, legalComments: 'linked', banner: { js: "import { createRequire as createDependencyRequire } from 'node:module'; const require = createDependencyRequire(import.meta.url);" } }));
  // Keep a self-contained application fallback, independent of command chunks.
  // Package dependencies remain external to preserve Effect service identity with
  // repository contributions and all public exports. Installation resources resolve their package owner independently of bundle depth.
  const closure = yield* Effect.tryPromise(() => build({ entryPoints: [dist('entry/cli/cli-fallback.js')], outfile: dist('entry/cli/cli-fallback-bundle.js'), metafile: true, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24', sourcemap: true }));
  yield* bundleCommands([dist('entry/server/operation/main.js')], false, '[name]', 'runtime-[hash]', true, dist('entry/server/operation'));
  const roots = [dist('entry/cli/entry.js'), dist('entry/cli/entry-full.js'), dist('entry/cli/cli.js')];
  const bootstrap = yield* Effect.tryPromise(() => build({ entryPoints: roots, outdir: dist('startup-graph'), write: false, metafile: true, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24' }));
  const definitions = yield* Effect.tryPromise(async () => {
    const file = dist('entry/cli/cli-full.js');
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
  const receipts = yield* Effect.all(calls.map(args => capture(args).pipe(Effect.flatMap(receipt => {
    if (args.at(-1) === '--help') {
      const usage = `concord${args.length === 1 ? '' : ` ${args.slice(0, -1).join(' ')}`}`;
      const actual = /(?:^|\n)USAGE\n\s+([^\n]+)/u.exec(receipt.stdout)?.[1];
      if (receipt.status !== 0 || actual === undefined || !(actual === usage || actual.startsWith(`${usage} `))) {
        return Effect.fail(new StartupBuildFailed({ message: `Help for ${usage} did not describe that command: ${receipt.stderr || receipt.stdout}` }));
      }
    }
    return Effect.succeed([JSON.stringify(args), receipt] as const);
  }))), { concurrency: 4 });
  const commands = [...new Set(Object.values(bootstrap.metafile!.inputs).flatMap(input => input.imports)
    .filter(item => item.kind === 'dynamic-import' && resolve(item.path).startsWith(dist('entry/cli') + '/')).map(item => item.path))];
  const skill = dist('entry/cli/skill.js');
  yield* bundleCommands(commands.filter(file => file !== skill));
  yield* bundleCommands([skill], false);
  const production = yield* Effect.tryPromise(() => build({ entryPoints: [...roots, dist('entry/cli/cli-fallback-bundle.js')], outdir: dist('startup-graph'), write: false, metafile: true, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24' }));
  // esbuild's input graph is the actual command-definition closure, including
  // ordinary imports and finite dynamic chunks, rather than a filename prefix.
  const emitted = [...new Set([...Object.keys(closure.metafile!.inputs), ...Object.keys(bootstrap.metafile!.inputs), ...roots])].filter(file => insideDist(file) && file.endsWith('.js')).sort();
  const modulePath = (file: string, root: string): string => {
    const path = relative(resolve(root, 'entry/cli'), resolve(file));
    return path.startsWith('.') ? path : `./${path}`;
  };
  const productionFiles = Object.keys(production.metafile!.inputs).filter(file => insideDist(file) && file.endsWith('.js')).sort();
  const files = Object.fromEntries(yield* Effect.all(productionFiles.map(file => digest(file).pipe(Effect.map(hash => [modulePath(file, distribution), hash] as const))), { concurrency: 8 }));
  const sourceFiles = Object.fromEntries(yield* Effect.all(emitted.map(file => join('src', relative(distribution, resolve(file))).replace(/\.js$/u, '.ts')).map(file => digest(file).pipe(Effect.map(hash => [modulePath(file, 'src'), hash] as const))), { concurrency: 8 }));
  const payload = {
    format: 'concord.startup/v1', packageDigest: yield* digest(join(packageRoot, 'package.json')), files, sourceFiles,
    receipts: Object.fromEntries(receipts),
    groups: definitions.fullCommand.subcommands.flatMap(group => group.commands.map(command => ({ name: command.name, ...(command.description === undefined ? {} : { description: command.description }) }))),
  };
  const data: StartupData = Schema.decodeUnknownSync(Data, { onExcessProperty: 'error' })({ ...payload, dataDigest: createHash('sha256').update(JSON.stringify(payload)).digest('hex') });
  yield* fs.writeFileString(dist('startup-data.js'), `// Generated from the complete CLI. Do not edit.\nexport default ${JSON.stringify(data)};\n`);
  yield* Console.error(`# Startup: recorded ${paths.length} help paths, version and no-argument output`);
});
