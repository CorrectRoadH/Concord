import { runApplication } from './repository.ts';
import { Effect, Schema } from 'effect';
import { getWorkspaceSnapshot } from "../../src/app/index.ts";
import { setConfig, showConfig } from "../../src/app/index.ts";
import { listFeedback } from "../../src/domain/feedback/index.ts";
import { LocalRepository } from "./repository.ts";

const [root, mode] = Schema.decodeUnknownSync(Schema.Tuple([Schema.String, Schema.Literals(['workspace', 'config-preview', 'feedback'])]))(process.argv.slice(2));
if (mode === 'workspace') await runApplication(getWorkspaceSnapshot(root, 'off'));
else await runApplication(Effect.tryPromise(async () => {
  const repo = (await LocalRepository.open(root, { access: 'read', persistentCache: 'off' }));
  try {
    if (mode === 'feedback') listFeedback(repo);
    else {
      const current = showConfig(repo);
      (await setConfig(repo, { ...current.config, testRoots: [...(current.config.testRoots ?? []), 'test-preview'] }, current.digest, true));
    }
  } finally { repo.close(); }
}));
