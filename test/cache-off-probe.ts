import { Effect, Schema } from 'effect';
import { getWorkspaceSnapshot } from '../dist/application.js';
import { setConfig, showConfig } from '../dist/editing.js';
import { listFeedback } from '../dist/feedback.js';
import { LocalRepository } from '../dist/storage.js';

const [root, mode] = Schema.decodeUnknownSync(Schema.Tuple([Schema.String, Schema.Literals(['workspace', 'config-preview', 'feedback'])]))(process.argv.slice(2));
if (mode === 'workspace') await Effect.runPromise(getWorkspaceSnapshot(root, 'off'));
else await Effect.runPromise(Effect.sync(() => {
  const repo = new LocalRepository(root, { access: 'read', persistentCache: 'off' });
  try {
    if (mode === 'feedback') listFeedback(repo);
    else {
      const current = showConfig(repo);
      setConfig(repo, { ...current.config, runner: { ...current.config.runner, timeoutMs: current.config.runner.timeoutMs + 1 } }, current.digest, true);
    }
  } finally { repo.close(); }
}));
