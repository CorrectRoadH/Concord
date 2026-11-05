import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Context, Effect, Layer, Schema } from 'effect';
import { ConcordError, failure } from '../../model/index.js';
import { packageRoot } from './location.js';
import { workerEntryArgv, workspaceInstallationIdentity, sourceInstallation } from './index.js';
import { manageHerdrMod } from './herdr-mod.js';

export interface TemplateResources {
  readonly manifest: string;
  readonly entries: readonly { readonly name: string; readonly regular: boolean }[];
  readonly read: (name: string) => string;
}

export class Installation extends Context.Service<Installation, {
  readonly worker: typeof workerEntryArgv;
  readonly identity: typeof workspaceInstallationIdentity;
  readonly cwd: string;
  readonly version: Effect.Effect<string, ConcordError>;
  readonly templates: Effect.Effect<TemplateResources, ConcordError>;
  readonly herdrMod: (operation: 'install' | 'uninstall', dryRun: boolean) => ReturnType<typeof manageHerdrMod>;
  readonly asset: (directory: 'p5-types' | 'web', path: string) => Effect.Effect<string, ConcordError>;
}>()('concord/base/installation/Installation') {
  static readonly layer = Layer.succeed(Installation, Installation.of({
    worker: (...args) => workerEntryArgv(...args), identity: () => workspaceInstallationIdentity(), cwd: packageRoot,
    herdrMod: (operation, dryRun) => manageHerdrMod(operation, process.env.HERDR_APP_HOME || join(homedir(), '.config/herdr-app'), join(packageRoot, 'dist/herdr-mod'), dryRun),
    version: Effect.try({ try: () => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ version: Schema.NonEmptyString })), { onExcessProperty: 'ignore' })(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version, catch: failure }),
    templates: Effect.try({ try: () => {
      const directory = join(packageRoot, 'templates');
      let manifest: string;
      try { manifest = readFileSync(join(directory, 'manifest.json'), 'utf8'); }
      catch (cause) { throw new ConcordError('TemplateManifestUnreadable', 'Cannot read the packaged template manifest', cause); }
      let entries: TemplateResources['entries'];
      try { entries = readdirSync(directory, { withFileTypes: true }).map(entry => ({ name: entry.name, regular: entry.isFile() })); }
      catch (cause) { throw new ConcordError('TemplateInventoryUnreadable', 'Cannot inspect the packaged template inventory', cause); }
      // Files are captured with the manifest for one operation; consumers receive no paths.
      const contents = new Map(entries.filter(entry => entry.regular && /^[a-z0-9-]+\.md$/u.test(entry.name)).map(entry => {
        try { return [entry.name, readFileSync(join(directory, entry.name), 'utf8')] as const; }
        catch { return [entry.name, undefined] as const; }
      }));
      return { manifest, entries, read: name => {
        const source = contents.get(name);
        if (source === undefined) throw new ConcordError('TemplateUnreadable', `Cannot read packaged template ${name.replace(/\.md$/u, '')}`);
        return source;
      } };
    }, catch: failure }),
    asset: (directory, path) => Effect.try({ try: () => {
      if (path.split('/').some(part => !part || part === '.' || part === '..') || path.includes('\\')) throw new ConcordError('UnsafePath', 'Invalid installation asset');
      const libraries = { 'p5.sound.js': 'p5.sound/dist/p5.sound.js', 'p5.brush.js': 'p5.brush/dist/p5.brush.js' };
      const absolute = sourceInstallation ? directory === 'p5-types' ? join(packageRoot, 'node_modules/p5/types', path)
        : path === 'p5-libraries/p5.js' ? join(packageRoot, 'node_modules/p5/lib/p5.min.js')
          : join(packageRoot, 'node_modules', libraries[path.replace('p5-libraries/', '') as keyof typeof libraries] ?? path)
        : join(packageRoot, 'dist', directory, path);
      if (!lstatSync(absolute).isFile()) throw new ConcordError('InvalidFile', 'Installation asset must be a regular file');
      return readFileSync(absolute, 'utf8');
    }, catch: failure }),
  }));
}
