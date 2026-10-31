// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#刷新与推送
import { Effect } from 'effect';
import { Workspace } from '../base/workspace/index.js';
import { workspaceInstallationIdentity } from '../base/installation/index.js';
import { ConcordError, digest, failure } from '../model/index.js';

/** Content identity includes input membership and the installed parsers and schemas. */
export const workspaceSourceDigest = Effect.fn('workspaceSourceDigest')(function*(root: string) {
  const workspace = yield* Workspace;
  const installation = yield* Effect.try({ try: workspaceInstallationIdentity, catch: failure });
  const config = yield* workspace.inspectConfiguration(root);
  if (!config.snapshot || !config.source) return digest(JSON.stringify([installation, config.digest]));
  return yield* Effect.scoped(Effect.gen(function*() {
    const repo = yield* workspace.openRead(root, { access: 'read', optimistic: true, persistentCache: 'off' });
    return yield* Effect.try({ try: () => repo.snapshot(() => {
      const paths = new Set(['concord.config.ts', ...(repo.config.runner?.sourceFiles ?? [])]);
      for (const directory of ['docs', 'memory', 'feedback']) for (const path of repo.files(directory)) paths.add(path);
      for (const directory of [...repo.config.testRoots, ...(repo.config.sourceRoots ?? [])]) for (const path of repo.files(directory, 'source')) paths.add(path);
      const inputs = [...paths].sort().map(path => { const bytes = repo.readBytes(path); return [path, bytes === undefined ? null : digest(bytes)]; });
      if (repo.configSnapshot.digest !== config.digest) throw new ConcordError('SourceChanged', 'Configuration changed while identifying workspace sources');
      return digest(JSON.stringify([installation, inputs]));
    }), catch: failure });
  }));
});
