import { Effect, Schema } from 'effect';
import { getWorkspaceSnapshot } from '../src/application.js';
import { setConfig, showConfig } from '../src/editing.js';
import { listFeedback } from '../src/feedback.js';
import { LocalRepository } from '../src/storage.js';

const [root, mode] = Schema.decodeUnknownSync(Schema.Tuple([Schema.String, Schema.Literals(['workspace', 'config-preview', 'feedback'])]))(process.argv.slice(2));
if (mode === 'workspace') await Effect.runPromise(getWorkspaceSnapshot(root, 'off'));
else await Effect.runPromise(Effect.sync(() => {
  const repo = new LocalRepository(root, { access: 'read', persistentCache: 'off' });
  try {
    if (mode === 'feedback') listFeedback(repo);
    else {
      const current = showConfig(repo);
      setConfig(repo, { ...current.config, testRoots: [...(current.config.testRoots ?? []), 'test-preview'] }, current.digest, true);
    }
  } finally { repo.close(); }
}));
