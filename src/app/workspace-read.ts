// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#协议
import { Effect } from 'effect';
import { Workspace } from '../base/workspace/index.ts';
import { Sources } from '../base/sources/index.ts';
import { ConcordError, digest, failure, type WorkspaceRead } from '../model/index.ts';
import { inspectDocumentFile, isSourcePath } from './editing.ts';

export const getWorkspaceRead = Effect.fn('getWorkspaceRead')(function*(root: string, path: string) {
  return yield* Effect.scoped(Effect.gen(function*() {
    const repo = yield* (yield* Workspace).openRead(root, { access: 'read', optimistic: true });
    return yield* (yield* Sources).snapshot(repo, Effect.try({ try: (): WorkspaceRead => {
      const document = inspectDocumentFile(repo, path);
      if (!document && !isSourcePath(repo, path) && path !== repo.configSnapshot.path) throw new ConcordError('FileNotFound', 'The requested source is no longer in the current inventory');
      const paths = new Set([path]);
      if (document) {
        const segments = path.split('/');
        for (let depth = 1; depth < segments.length; depth++) {
          const owner = `${segments.slice(0, depth).join('/')}/README.md`;
          if (repo.readBytes(owner) !== undefined) paths.add(owner);
        }
      }
      const files = [...paths].map(path => { const bytes = repo.readBytes(path); if (!bytes) throw new ConcordError('SourceChanged', 'A read file disappeared'); return { path, bytes }; });
      const target = files.find(file => file.path === path)!;
      const targetDigest = digest(target.bytes);
      if (document && targetDigest !== document.digest) throw new ConcordError('SourceChanged', 'The directed source changed while reading');
      return { envelope: { path, digest: targetDigest, files: files.map(file => ({ path: file.path, digest: digest(file.bytes), length: file.bytes.byteLength, diagnostics: [] })) }, files };
    }, catch: failure }));
  }));
});
