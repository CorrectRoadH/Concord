import assert from 'node:assert/strict';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import test from 'node:test';
import { createMemoryHawdb } from '../../src/base/cache/index.ts';
import { makeRuntimeEnvironment, runtimeCacheHome } from '../../src/base/environment/index.ts';
import { nativeArtifactRoot } from '../../src/base/installation/index.ts';
import { repositoryRuntime } from '../../src/base/workspace/index.ts';
import { LocalRepository } from '../support/repository.ts';
import { createConsumer } from '../support/consumer.ts';

// @feature docs/engineering/testing/architecture.md#进程内-cli
test('synchronous repository consumers resolve a relative native cache from each caller directory', () => {
  const root = createConsumer();
  const source = nativeArtifactRoot(makeRuntimeEnvironment(process.cwd(), process.env));
  try {
    const callers = ['a', 'b'].map(name => {
      const cwd = join(root, name), cache = join(cwd, 'cache');
      mkdirSync(cwd);
      const destination = join(cache, 'concord/native', basename(source));
      mkdirSync(destination, { recursive: true });
      cpSync(source, destination, { recursive: true });
      return { cwd, cache, value: name };
    });
    for (const index of [0, 1, 0]) {
      const caller = callers[index]!;
      const env: NodeJS.ProcessEnv = { ...process.env, XDG_CACHE_HOME: 'cache', CONCORD_REPOSITORY_CALLER: caller.value };
      delete env.HOME; delete env.USERPROFILE;
      const runtime = makeRuntimeEnvironment(caller.cwd, env);
      const repo = new LocalRepository(root, { access: 'read', runtime });
      try {
        env.XDG_CACHE_HOME = 'changed-after-construction';
        const captured = repositoryRuntime(repo);
        assert.equal(runtimeCacheHome(captured), caller.cache);
        assert.equal(captured.env.HOME, undefined);
        assert.equal(captured.env.CONCORD_REPOSITORY_CALLER, caller.value);
        const database = createMemoryHawdb(captured);
        try {
          database.put('document_parse', [{ key: 'caller', payload: caller.value }]);
          assert.deepEqual(database.get('document_parse', ['caller']), [{ key: 'caller', payload: caller.value }]);
        } finally { database.close(); }
        assert.throws(() => database.get('document_parse', ['caller']), { code: 'HawdbClosed' });
      } finally { repo.close(); }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
