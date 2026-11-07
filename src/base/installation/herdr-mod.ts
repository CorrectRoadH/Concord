// @concord-file
// @concord-implements docs/feature/herdr-mod/cli.md#安装与卸载
// @concord-implements docs/feature/herdr-mod/use-case/install-with-cli.md
import { Effect, FileSystem, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { join } from 'node:path';
import { ConcordError, failure } from '../../model/index.ts';
import { makeRuntimeEnvironment, type RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import { packageRoot } from './location.ts';
import { modManifest } from '../../model/herdr-mod/index.ts';

declare const CONCORD_COMPILED: boolean;

export interface HerdrInstallHost {
  readonly available: Effect.Effect<boolean, ConcordError>;
  readonly check: (path: string) => Effect.Effect<{ code: number; output: string }, ConcordError>;
}
export interface HerdrModReceipt {
  readonly operation: 'herdr-install' | 'herdr-uninstall';
  readonly path: string;
  readonly dryRun?: true;
  readonly updated?: true;
  readonly absent?: true;
  readonly openHerdr?: true;
}
const herdrCommand = Effect.fn('Installation.herdrCommand')(function*(args: readonly string[], runtime: RuntimeEnvironmentSnapshot) {
  const child = yield* (yield* ChildProcessSpawner.ChildProcessSpawner).spawn(ChildProcess.make('herdr-app', args, { cwd: runtime.cwd, env: runtime.env, extendEnv: false, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }));
  const reply = yield* Effect.all({ code: child.exitCode, stdout: Stream.mkString(Stream.decodeText(child.stdout)), stderr: Stream.mkString(Stream.decodeText(child.stderr)) }, { concurrency: 'unbounded' });
  return { code: Number(reply.code), output: reply.stdout + reply.stderr };
}, Effect.scoped, Effect.mapError(failure));

/** Replace only this mod's packaged files, using rename for possibly mapped files. */
export const manageHerdrMod = Effect.fn('Installation.manageHerdrMod')(function*(
  operation: 'install' | 'uninstall', appHome: string, resources: string, dryRun = false, sourceRoot?: string, host?: HerdrInstallHost, runtime: RuntimeEnvironmentSnapshot = makeRuntimeEnvironment(packageRoot, {}),
) {
  const fs = yield* FileSystem.FileSystem;
  const homeExists = yield* fs.exists(appHome);
  const path = join(appHome, 'mods', 'concord');
  // readLink does not follow the destination: never write through a different mod.
  const linked = yield* fs.readLink(path).pipe(Effect.map(() => true), Effect.catch(() => Effect.succeed(false)));
  const exists = linked || (yield* fs.exists(path));
  const receipt: HerdrModReceipt = { operation: `herdr-${operation}` as const, path, ...(dryRun ? { dryRun: true } : {}),
    ...(operation === 'install' && exists ? { updated: true } : {}), ...(operation === 'uninstall' && !exists ? { absent: true } : {}) };
  if (exists) {
    const notice = linked ? '' : yield* fs.readFileString(join(path, 'NOTICE.txt')).pipe(Effect.catch(() => Effect.succeed('')));
    if (linked || !notice.startsWith('Concord Herdr mod bundles Effect.\n')) return yield* Effect.fail(new ConcordError('HerdrModPathOccupied', `Concord mod path is occupied${linked ? ' by a symbolic link' : ''}; rename or remove it before retrying: ${path}`));
  }
  if (operation === 'uninstall') {
    if (!dryRun) yield* fs.remove(path, { recursive: true, force: true });
    return receipt;
  }
  const available = host ? yield* host.available : yield* herdrCommand(['--version'], runtime).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false)));
  if ((!homeExists && !available) || (homeExists && (yield* fs.stat(appHome)).type !== 'Directory')) {
    return yield* Effect.fail(new ConcordError('HerdrNotFound', 'Install Herdr: curl -fsSL https://releases.herdr.dev/app/install.sh | sh\nThen run concord herdr install'));
  }
  if (dryRun) return receipt;
  yield* fs.makeDirectory(appHome, { recursive: true });
  const assets = ['main.js', 'mod.json', 'NOTICE.txt'];
  const generated = new Map<string, string>();
  if (!(typeof CONCORD_COMPILED !== 'undefined' && CONCORD_COMPILED) && sourceRoot !== undefined) {
    const scratch = yield* fs.makeTempDirectoryScoped({ directory: appHome, prefix: '.concord-mod-build-' });
    yield* Effect.acquireRelease(Effect.tryPromise(async () => {
      const { build } = await import('vite-plus/pack');
      return build({ config: false, clean: false, dts: false, sourcemap: false, logLevel: 'silent', tsconfig: join(sourceRoot, 'tsconfig.json'),
        entry: { main: join(sourceRoot, 'src/entry/herdr-mod/main.ts') }, outDir: scratch,
        format: 'esm', platform: 'neutral', target: 'es2022', minify: true,
        deps: { neverBundle: ['gpui-kit', 'gpui-base', 'herdr'], alwaysBundle: /^(?!gpui-kit$|gpui-base$|herdr$)/u, onlyBundle: false },
        outputOptions: { entryFileNames: '[name].js', comments: { legal: true } } });
    }), handle => Effect.promise(async () => {
      for (const bundle of handle.bundles) await bundle[Symbol.asyncDispose]();
    }));
    generated.set('main.js', yield* fs.readFileString(join(scratch, 'main.js')));
    const version = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ version: Schema.NonEmptyString })), { onExcessProperty: 'ignore' })(yield* fs.readFileString(join(sourceRoot, 'package.json')));
    generated.set('mod.json', JSON.stringify(modManifest(version.version)) + '\n');
    generated.set('NOTICE.txt', `Concord Herdr mod bundles Effect.\n\n${yield* fs.readFileString(join(sourceRoot, 'node_modules/effect/LICENSE'))}`);
  } else for (const name of assets) {
    if (!(yield* fs.exists(join(resources, name)))) return yield* Effect.fail(new ConcordError('BuildRequired', 'Build Concord before installing the Herdr mod'));
  }
  yield* fs.makeDirectory(path, { recursive: true });
  for (const name of assets) {
    const temporary = join(path, `.${name}.${process.pid}.tmp`);
    const source = generated.get(name);
    yield* (source === undefined ? fs.copyFile(join(resources, name), temporary) : fs.writeFileString(temporary, source)).pipe(
      Effect.andThen(fs.rename(temporary, join(path, name))),
      Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.orDie)),
    );
  }
  if (available) {
    const checked = yield* (host ? host.check(path) : herdrCommand(['check', path], runtime)).pipe(Effect.catch(cause => Effect.succeed({ code: 1, output: cause.message })));
    if (checked.code !== 0) return yield* Effect.fail(new ConcordError('HerdrModCheckFailed', 'Herdr rejected the installed Concord mod', { output: checked.output }));
  }
  return { ...receipt, ...(!homeExists ? { openHerdr: true as const } : {}) };
}, Effect.scoped, Effect.mapError(failure));
