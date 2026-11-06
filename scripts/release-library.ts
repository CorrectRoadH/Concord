import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { Effect, FileSystem, Schema } from 'effect';
import { API } from 'typescript/sync';
import * as ts from 'typescript/ast';
import { parse } from 'yaml';
import { ArchiveFailed, run } from './archive-support.ts';

export const libraryEntries = {
  './config': 'dist/model/config-public', './model': 'dist/model/index',
  './test-adapter-protocol': 'dist/model/test-adapter-protocol', './change-preview': 'dist/model/change-preview',
} as const;
const Manifest = Schema.Struct({ name: Schema.Literal('concord-sdlc'), version: Schema.String, gitHead: Schema.String, license: Schema.optional(Schema.String) });
const LockedDependencies = Schema.Record(Schema.String, Schema.Struct({ version: Schema.String }));
const Lock = Schema.Struct({ importers: Schema.Struct({ '.': Schema.Struct({ dependencies: LockedDependencies, devDependencies: Schema.optional(LockedDependencies) }) }) });
const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`)]);

export const packLibrary = Effect.fn('archive.library')(function*(destination: string, applicationRoot: string) {
  const fs = yield* FileSystem.FileSystem;
  const pkg = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest), { onExcessProperty: 'ignore' })(yield* fs.readFileString(join(applicationRoot, 'package.json')));
  const lock = yield* fs.readFileString(join(applicationRoot, 'pnpm-lock.yaml')).pipe( Effect.flatMap(text => Effect.try({ try: () => parse(text), catch: cause => cause })), Effect.flatMap(value => Schema.decodeUnknownEffect(Lock, { onExcessProperty: 'ignore' })(value)));
  const scratch = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-library-' });
  const output = join(scratch, 'package');
  yield* fs.makeDirectory(output);
  const api = yield* Effect.acquireRelease(Effect.sync(() => new API({ runExternalCode: false })), api => Effect.sync(() => api.close()));
  const pending = Object.values(libraryEntries).flatMap(entry => [`${entry}.js`, `${entry}.d.ts`]);
  const visited = new Set<string>(), dependencies = new Map<string, string>();
  while (pending.length) {
    const file = pending.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    const absolute = resolve(applicationRoot, file);
    const inside = relative(applicationRoot, absolute);
    if (inside.startsWith('..') || !file.startsWith('dist/')) return yield* new ArchiveFailed({ message: `Library import escapes implementation: ${file}` });
    const text = yield* fs.readFileString(absolute);
    const imports = yield* Effect.sync(() => {
      const source = api.createSourceFile(file, text, { scriptKind: file.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS });
      try {
        const found: string[] = [];
        const visit = (node: ts.Node): void => {
          if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
          if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) found.push(node.argument.literal.text);
          if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) found.push(node.arguments[0].text);
          node.forEachChild(visit);
        };
        visit(source.sourceFile);
        return found;
      } finally { source.dispose(); }
    });
    for (const specifier of imports) {
      if (specifier.startsWith('.')) {
        const path = relative(applicationRoot, resolve(dirname(absolute), specifier));
        pending.push(file.endsWith('.d.ts') ? path.replace(/\.(?:js|ts)$/u, '.d.ts') : path);
      } else if (!builtins.has(specifier)) {
        let name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!;
        const importer = lock.importers['.'];
        if (!importer.dependencies[name] && file.endsWith('.d.ts')) name = `@types/${name.replace(/^@/u, '').replace('/', '__')}`;
        const version = (importer.dependencies[name] ?? importer.devDependencies?.[name])?.version.split('(')[0];
        if (!version || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(version)) return yield* new ArchiveFailed({ message: `Library dependency is not pinned in lock: ${specifier}` });
        dependencies.set(name, version);
      }
    }
    const target = join(output, file);
    yield* fs.makeDirectory(dirname(target), { recursive: true });
    const emitted = file.endsWith('.d.ts') ? text.replace(/(from\s+['"]|import\(['"])(\.[^'"]+)\.ts(['"])/gu, '$1$2.js$3') : text;
    yield* fs.writeFileString(target, emitted.replace(/^\/\/[#@] sourceMappingURL=.*$/gmu, ''));
  }
  const exports = Object.fromEntries(Object.entries(libraryEntries).map(([key, value]) => [key, { types: `./${value}.d.ts`, import: `./${value}.js` }]));
  yield* fs.writeFileString(join(output, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, gitHead: pkg.gitHead, type: 'module', license: pkg.license ?? 'UNLICENSED', exports, dependencies: Object.fromEntries([...dependencies].sort()) }, null, 2) + '\n');
  yield* fs.makeDirectory(destination, { recursive: true });
  const filename = resolve(destination, `concord-sdlc-${pkg.version}.tgz`);
  yield* run('tar', [...(process.platform === 'linux' ? ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner'] : []), '-czf', filename, '-C', scratch, 'package']);
  return { name: pkg.name, version: pkg.version, gitHead: pkg.gitHead, filename, files: [...visited].sort(), dependencies: Object.fromEntries(dependencies) };
}, Effect.scoped);
