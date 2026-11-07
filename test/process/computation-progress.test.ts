// 跨进程保证：真实计算进程在同步来源读取期间持续消耗CPU，超过60秒的逻辑时钟仍可完成请求并复用进程。
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { NodeServices } from '@effect/platform-node';
import { Installation } from '../../src/base/installation/index.ts';
import { makeRuntimeEnvironment, RuntimeEnvironment } from '../../src/base/environment/index.ts';
import { makeComputationOwner } from '../../src/entry/server/main.ts';
import { fixture, useCasePath } from '../support/document-cache-fixture.ts';
import { pollUntil } from '../support/support.ts';
import { tmpdir } from '../support/temporary.ts';

// @feature docs/feature/local-data-engine/architecture.md#进程与资源
// @issue docs/issues/large-repo-compute-restart-loop.md
test('a cold computation with CPU progress survives sixty seconds and completes without restarting', { skip: process.platform === 'win32' }, async () => {
  const root = fixture();
  const boundary = mkdtempSync(join(tmpdir(), 'concord-compute-busy-'));
  const environment = Object.fromEntries(Object.entries({ ...process.env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${fileURLToPath(new URL('../fixtures/computation-busy-preload.ts', import.meta.url))}`.trim(),
    CONCORD_TEST_BUSY_BOUNDARY: boundary, CONCORD_TEST_BUSY_SOURCE: join(root, useCasePath),
  }).filter((entry): entry is [string, string] => entry[1] !== undefined));
  try {
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const owner = yield* makeComputationOwner(root);
      const operation = { kind: 'query', request: { name: 'documents.list', input: {} }, cwd: root, environment } as const;
      const running = yield* Effect.forkScoped(owner.run(operation).pipe(Effect.result));
      yield* Effect.gen(function*() {
        yield* Effect.promise(() => pollUntil(async () => existsSync(join(boundary, 'progress')) ? true : undefined, { description: 'real compute reaches the busy source boundary' }));
        const pid = Number(readFileSync(join(boundary, 'entered'), 'utf8'));
        for (let step = 0; step < 4; step++) {
          const before = readFileSync(join(boundary, 'progress'), 'utf8');
          yield* TestClock.adjust('20 seconds');
          yield* Effect.promise(() => pollUntil(async () => running.pollUnsafe() !== undefined || readFileSync(join(boundary, 'progress'), 'utf8') !== before ? true : undefined, { description: 'computation makes progress or returns its terminal result' }));
          if (running.pollUnsafe() !== undefined) break;
        }
        writeFileSync(join(boundary, 'release'), '');
        const result = yield* Fiber.join(running);
        assert.equal(result._tag, 'Success', `CPU progress must keep a legal cold computation alive beyond sixty seconds: ${JSON.stringify(result)}`);
        assert.doesNotThrow(() => process.kill(pid, 0), 'the same computation process remains reusable');
        assert.deepEqual(yield* owner.run(operation), result._tag === 'Success' ? result.success : undefined);
      }).pipe(Effect.ensuring(Effect.sync(() => { writeFileSync(join(boundary, 'release'), ''); })));
    })).pipe(Effect.provide(Installation.layer), Effect.provide(NodeServices.layer), Effect.provide(RuntimeEnvironment.layer(makeRuntimeEnvironment(root, environment))), Effect.provide(TestClock.layer())));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(boundary, { recursive: true, force: true });
  }
});
