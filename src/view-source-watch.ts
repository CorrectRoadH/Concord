// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { watch, type FSWatcher } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { isAbsolute, join, normalize, relative, sep } from 'node:path';
import { Effect } from 'effect';
import { assertLeasePath } from './file-lease.js';
import { ConcordError, type ProjectConfig } from './shared.js';
import { excludedSourcePath } from './source-discovery.js';

interface WatchedDirectory { readonly handle: FSWatcher; readonly identity: string }
const ignored = new Set(['.git', 'node_modules']);
const unavailable = (cause: unknown): ConcordError => new ConcordError('WorkspaceWatchUnavailable',
  `Source watching is unavailable; periodic refresh remains active: ${cause instanceof Error ? cause.message : String(cause)}`);

/** Events only invalidate. The snapshot reader still validates all source bytes and paths. */
export class ViewSourceWatch {
  private readonly directories = new Map<string, WatchedDirectory>();
  private scopes: readonly string[] = [];
  private sourceScopes: readonly string[] = [];
  private strictScopes: readonly string[] = [];
  private sourceIgnore: readonly string[] = [];
  private stopped = false;
  private failure: ConcordError | undefined;

  constructor(private readonly root: string, private readonly changed: () => void, private readonly failed: (error: ConcordError) => void) {}

  reconcile(project: ProjectConfig | null, sources: readonly { readonly path: string }[] = []): Promise<boolean> {
    return Effect.runPromise(Effect.tryPromise({ try: () => this.update(project, sources), catch: unavailable }));
  }

  private relevant(path: string): boolean {
    return this.scopes.some(scope => scope === '' || path === scope || path.startsWith(`${scope}${sep}`) || scope.startsWith(`${path}${sep}`));
  }

  private excluded(path: string): boolean {
    const parts = path.split(sep);
    if (parts.some(part => ignored.has(part))) return true;
    const sources = this.sourceScopes.filter(scope => path === scope || path.startsWith(`${scope}${sep}`) || scope.startsWith(`${path}${sep}`));
    return sources.length > 0
      && sources.every(scope => excludedSourcePath(path.split(sep).join('/'), scope.split(sep).join('/'), this.sourceIgnore))
      && !this.strictScopes.some(scope => path === scope || path.startsWith(`${scope}${sep}`) || scope.startsWith(`${path}${sep}`));
  }

  private async update(project: ProjectConfig | null, sources: readonly { readonly path: string }[]): Promise<boolean> {
    if (this.stopped) return false;
    this.failure = undefined;
    this.sourceIgnore = project?.sourceIgnore ?? [];
    this.sourceScopes = [...(project?.sourceRoots ?? []), ...(project?.testRoots ?? [])].map(path => normalize(path));
    this.strictScopes = ['concord.config.ts', 'docs', ...(project?.runner.sourceFiles ?? []),
      ...(project?.memorySources?.map(source => source.path) ?? ['memory']), ...sources.map(source => source.path)].map(path => normalize(path));
    const scopes = ['concord.config.ts', 'docs', ...(project?.sourceRoots ?? []), ...(project?.testRoots ?? []),
      ...(project?.runner.sourceFiles ?? []), ...(project?.memorySources?.map(source => source.path) ?? ['memory']), ...sources.map(source => source.path)];
    this.scopes = [...new Set(scopes.map(path => {
      const value = normalize(path);
      if (isAbsolute(value) || value === '..' || value.startsWith(`..${sep}`)) throw new ConcordError('UnsafePath', 'Watch source must stay inside the worktree');
      return value === '.' ? '' : value;
    }))].filter(path => !path.split(sep).some(part => ignored.has(part)));
    for (const [path, value] of this.directories) {
      if (path !== this.root && !this.relevant(relative(this.root, path))) { value.handle.close(); this.directories.delete(path); }
    }
    const desired = new Set<string>();
    let added = false;
    const visit = async (path: string): Promise<void> => {
      if (this.stopped || desired.has(path)) return;
      const rel = relative(this.root, path);
      if (rel && (!this.relevant(rel) || this.excluded(rel))) return;
      // Never descend through a symbolic link, including a replaced ancestor.
      assertLeasePath(path);
      const stat = await lstat(path).catch((cause: NodeJS.ErrnoException) => {
        if (cause.code === 'ENOENT' || cause.code === 'ENOTDIR') return undefined;
        throw cause;
      });
      if (!stat || !stat.isDirectory() || stat.isSymbolicLink() || this.stopped) return;
      if (desired.size >= 8192) throw new Error('Source watch exceeds 8192 directories');
      desired.add(path);
      const identity = `${stat.dev}:${stat.ino}`;
      const previous = this.directories.get(path);
      if (previous?.identity !== identity) {
        previous?.handle.close();
        this.directories.delete(path);
        if (this.directories.size >= 8192) throw new Error('Source watch exceeds 8192 directory handles');
        const handle = watch(path, { persistent: false }, (_event, filename) => {
          if (this.stopped) return;
          if (filename === null) { this.changed(); return; }
          const eventPath = relative(this.root, join(path, filename.toString()));
          if (!this.excluded(eventPath) && this.relevant(eventPath)) this.changed();
        });
        handle.on('error', cause => {
          handle.close();
          if (this.directories.get(path)?.handle === handle) this.directories.delete(path);
          if (!this.stopped) { this.failure = unavailable(cause); this.failed(this.failure); }
        });
        this.directories.set(path, { handle, identity });
        added = true;
      }
      assertLeasePath(path);
      const entries = await readdir(path, { withFileTypes: true }).catch((cause: NodeJS.ErrnoException) => {
        if (cause.code === 'ENOENT' || cause.code === 'ENOTDIR') return [];
        throw cause;
      });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.isSymbolicLink() && !ignored.has(entry.name)) await visit(join(path, entry.name));
      }
    };
    try {
      await visit(this.root);
    } finally {
      for (const [path, value] of this.directories) if (!desired.has(path)) { value.handle.close(); this.directories.delete(path); }
    }
    if (this.failure) throw this.failure;
    return added;
  }

  close(): void {
    this.stopped = true;
    for (const value of this.directories.values()) value.handle.close();
    this.directories.clear();
  }
}
