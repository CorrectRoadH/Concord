// 跨进程保证：网络——真实HTTP下载校验失败不发布，完整字节按摘要复用且不重复请求。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { NodeServices } from '@effect/platform-node';
import { sha256, verifiedDownload } from '../../scripts/archive-support.ts';

// @feature docs/engineering/build/architecture.md#归档组装
test('runtime download cache publishes only verified complete bytes and reuses them', async () => {
  const cache = await mkdtemp(join(tmpdir(), 'concord-runtime-download-'));
  const bytes = Buffer.from('official boundary fixture');
  let requests = 0;
  const server = createServer((_request, response) => { requests++; response.end(bytes); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/runtime`;
  const download = (digest: string) => Effect.runPromise(verifiedDownload(url, digest, cache).pipe(Effect.scoped, Effect.provide(NodeServices.layer)));
  try {
    await assert.rejects(download('0'.repeat(64)), /SHA-256 mismatch/);
    assert.deepEqual(await readdir(cache), []);
    const digest = sha256(bytes);
    const path = await download(digest);
    assert.equal(path, join(cache, digest));
    assert.deepEqual(await readFile(path), bytes);
    assert.equal(await download(digest), path);
    assert.equal(requests, 2);
    assert.deepEqual(await readdir(cache), [digest]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(cache, { recursive: true });
  }
});
