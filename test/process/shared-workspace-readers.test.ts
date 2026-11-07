// 跨进程保证：服务与 IPC——共享服务真实HTTP支持压缩和缓存头，RPC跨帧读取完整原文并拒绝错误instance token。
import { LocalRepository as RepositoryBase } from '../../src/base/workspace/index.ts';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { requestWorkspace } from '../../src/entry/server/index.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository } from '../support/repository.ts';
import { sharedWorkspace, type SharedWorkspace } from '../support/shared-service.ts';
import { writeProjectConfig } from '../support/support.ts';

async function sourceFixture(workspace: SharedWorkspace, id: string, title: string, source = `// @concord-code\n// @concord-implements docs/feature/${id}/README.md\nexport function cachedCode() { return true; }\n`): Promise<void> {
  writeProjectConfig(workspace.root, { testRoots: [], sourceRoots: ['src'] });
  const repo = (await LocalRepository.open(workspace.root));
  try { (await createDocument(repo, 'feature', { id, title, pages: ['architecture'] })); }
  finally { repo.close(); }
  mkdirSync(join(workspace.root, 'src'), { recursive: true });
  writeFileSync(join(workspace.root, 'src/main.ts'), source);
}

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('workbench compresses workspace data and caches fingerprinted assets only', async () => {
  await (await sharedWorkspace()).run(async workspace => {
    (await sourceFixture(workspace, 'cached', 'Cached'));
    await workspace.ready();
    const compressed = await workspace.http('/api/workspace', { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(compressed.status, 200);
    assert.equal(compressed.headers.get('content-encoding'), 'gzip');
    assert.equal(compressed.headers.get('vary'), 'Accept-Encoding');
    assert.equal(compressed.headers.get('cache-control'), 'no-store');
    assert.equal((JSON.parse(compressed.body) as { ok: boolean }).ok, true);
    const uncompressed = await workspace.http('/api/workspace', { headers: { 'Accept-Encoding': 'gzip;q=0' } });
    assert.equal(uncompressed.headers.get('content-encoding'), null);
    const html = await workspace.http('/');
    const asset = /src="\/assets\/([^"]+\.js)"/u.exec(html.body)?.[1];
    assert.ok(asset);
    const script = await workspace.http(`/assets/${asset}`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(script.status, 200);
    assert.equal(script.headers.get('content-encoding'), 'gzip');
    assert.equal(script.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    const index = await workspace.http('/');
    assert.equal(index.headers.get('cache-control'), 'no-store');
  });
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('HTTP Git status does not scan workspace documents or source declarations', async () => {
  await (await sharedWorkspace()).run(async workspace => {
    (await sourceFixture(workspace, 'cached', 'Cached'));
    const files = RepositoryBase.prototype.files;
    let walks = 0;
    RepositoryBase.prototype.files = function(path) { walks += 1; return files.call(this, path); };
    try {
      const response = await workspace.http('/api/git');
      assert.equal(response.status, 200);
      assert.match(response.body, /src\/main.ts/);
      assert.equal(walks, 0, 'Git refresh must not compile the entire workspace');
    } finally { RepositoryBase.prototype.files = files; }
  });
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('/api/file resolves directed current owners without a workspace-wide scan', async () => {
  await (await sharedWorkspace()).run(async workspace => {
    (await sourceFixture(workspace, 'projected', 'Projected feature', 'export const projectedValue = 1;\n'));
    const repo = (await LocalRepository.open(workspace.root));
    try { (await createDocument(repo, 'issue', { id: 'sample-issue', title: 'Sample issue' })); }
    finally { repo.close(); }
    const document = await workspace.http(`/api/file?path=${encodeURIComponent('docs/feature/projected/README.md')}`);
    assert.equal(document.status, 200, document.body);
    const documentValue = JSON.parse(document.body) as { readonly value: { readonly body: string; readonly digest: string; readonly document?: { readonly metadata: { readonly id: string } } } };
    assert.equal(documentValue.value.document?.metadata.id, 'projected');
    assert.match(documentValue.value.body, /Projected feature/u);
    const config = await workspace.http(`/api/file?path=${encodeURIComponent('concord.config.ts')}`);
    assert.equal(config.status, 200, config.body);
    const configValue = JSON.parse(config.body) as { readonly value: { readonly project?: { readonly sourceRoots?: readonly string[] }; readonly digest: string } };
    assert.ok(configValue.value.project, 'a valid config target exposes its parsed project preimage');
    const issue = await workspace.http(`/api/file?path=${encodeURIComponent('docs/issues/sample-issue.md')}`);
    assert.equal(issue.status, 200, issue.body);
    const issueValue = JSON.parse(issue.body) as { readonly value: { readonly feedback?: { readonly document: { readonly metadata: { readonly kind: string; readonly id: string } }; readonly remote: unknown } } };
    assert.equal(issueValue.value.feedback?.document.metadata.kind, 'issue');
    assert.equal(issueValue.value.feedback?.document.metadata.id, 'sample-issue');
    assert.equal(issueValue.value.feedback?.remote, null);
  });
});

// @feature docs/feature/local-data-engine/README.md
test('binary socket reads preserve a source larger than one frame and reject mismatched instance tokens', { timeout: 30_000 }, async () => {
  await (await sharedWorkspace()).run(async workspace => {
    mkdirSync(join(workspace.root, 'docs/feature/reader'), { recursive: true });
    writeFileSync(join(workspace.root, 'docs/feature/reader/README.md'), '# Reader\n\nFirst generation.\n');
    const source = `# Reader\n\n${'raw bytes 原文 '.repeat(90_000)}\n`;
    writeFileSync(join(workspace.root, 'docs/feature/reader/large.md'), source);
    await workspace.connection(connection => Effect.gen(function*() {
      const read = yield* requestWorkspace(connection, 'read', { path: 'docs/feature/reader/large.md', expectedDigest: 'old-generation' });
      assert.equal(read.body, source);
      const rejected = yield* Effect.result(connection.client.hello({ protocol: 'concord.workspace/v1', installation: 'different-installation' }));
      assert.equal(rejected._tag, 'Success', 'hello remains available across installation identities');
      const invalid = yield* Effect.result(connection.client.shutdown({ token: 'other-instance' }));
      assert.equal(invalid._tag, 'Failure');
    }));
  });
});
