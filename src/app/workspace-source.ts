// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#刷新与推送
import { Effect } from 'effect';
import { Workspace } from '../base/workspace/index.ts';
import { RuntimeEnvironment } from '../base/environment/index.ts';
import { workspaceInstallationIdentity } from '../base/installation/index.ts';
import { statechartProjectionInputs } from '../domain/documents/index.ts';
import { ConcordError, digest, failure, type StatechartWatch } from '../model/index.ts';

/** Content identity includes input membership and the installed parsers and schemas. */
export const workspaceSourceSnapshot = Effect.fn('workspaceSourceSnapshot')(function*(root: string) {
  const workspace = yield* Workspace;
  const runtime = yield* RuntimeEnvironment;
  const installation = yield* Effect.try({ try: () => workspaceInstallationIdentity(runtime), catch: failure });
  const config = yield* workspace.inspectConfiguration(root);
  if (!config.snapshot || config.source === undefined) return { sourceDigest: digest(JSON.stringify([installation, config.digest])) };
  return yield* Effect.scoped(Effect.gen(function*() {
    const repo = yield* workspace.openRead(root, { access: 'read', optimistic: true, persistentCache: 'off' });
    return yield* Effect.try({ try: () => repo.snapshot((): { sourceDigest: string; statechartWatch?: StatechartWatch } => {
      const docs = repo.files('docs');
      const paths = new Set(['concord.config.ts', ...docs]);
      for (const directory of ['memory', 'feedback']) for (const path of repo.files(directory)) paths.add(path);
      for (const directory of [...repo.config.testRoots, ...(repo.config.sourceRoots ?? [])]) for (const path of repo.files(directory, 'source')) paths.add(path);
      const inputs = [...paths].sort().map(path => { const bytes = repo.readBytes(path); return [path, bytes === undefined ? null : digest(bytes)]; });
      const statecharts = statechartProjectionInputs(repo, docs);
      if (repo.configSnapshot.digest !== config.digest) throw new ConcordError('SourceChanged', 'Configuration changed while identifying workspace sources');
      if (statecharts.inputs.length === 0) return { sourceDigest: digest(JSON.stringify([installation, inputs])) };
      return { sourceDigest: digest(JSON.stringify([installation, inputs, statecharts.inputs])), statechartWatch: statecharts.watch };
    }), catch: failure });
  }));
});

export const workspaceSourceDigest = (root: string) => workspaceSourceSnapshot(root).pipe(Effect.map(value => value.sourceDigest));
