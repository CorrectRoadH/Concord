import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { Effect, Schema } from 'effect';
import { ViewRequestLog } from '../dist/view-request-log.js';

const Record = Schema.Struct({
  method: Schema.String, route: Schema.String, status: Schema.Number, completed: Schema.Boolean,
  durationMs: Schema.Number, eventLoopDelayMs: Schema.Number, phase: Schema.String,
  phases: Schema.Array(Schema.Struct({ name: Schema.String, ms: Schema.Number, count: Schema.Number })),
  reasons: Schema.Array(Schema.String), suppressed: Schema.Number,
});

// @use-case docs/feature/web-workbench/use-case/use-web-workbench.md
test('real HTTP slow logs redact inputs, distinguish incomplete 200 responses, and bound emission and phase cardinality', () => Effect.runPromise(Effect.tryPromise(async () => {
  let now = 0;
  const lines: string[] = [];
  let brokenSink = false;
  const log = new ViewRequestLog(line => { if (brokenSink) throw new Error('sink unavailable'); lines.push(line); return true; }, () => now);
  const server = createServer((request, response) => {
    const timing = log.begin(request, response);
    timing.sync('view.compileWorkspace', () => { now += 300; });
    for (let index = 0; index < 100; index++) timing.record(`untrusted/${index}`, 1);
    timing.workspace({ complete: false, findings: [{ code: 'CodeSourceChanged' }], cache: { status: 'unavailable', detail: 'native binary digest differs: secret-install-path' } });
    timing.cache({ status: 'unavailable', hits: 12, misses: 3, detail: 'HawdbBusy: secret-cache-path' }, 'code');
    request.resume(); response.end('ok');
  });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/api/action?token=secret-query`;
    const request = async (target = url) => {
      const response = await fetch(target, { method: 'POST', body: 'secret-body', headers: { authorization: 'secret-header' } });
      assert.equal(response.status, 200); assert.equal(await response.text(), 'ok');
    };
    for (let index = 0; index < 25; index++) await request();
    assert.equal(lines.length, 20);
    now += 60_000;
    await request(url.replace('/api/action', '/api/secret-path'));
    assert.equal(lines.length, 21);
    const parse = (line: string) => Schema.decodeUnknownSync(Schema.fromJsonString(Record))(line.replace(/^Concord view slow request /u, ''));
    const first = parse(lines[0]!);
    assert.equal(first.route, '/api/action');
    assert.equal(first.method, 'POST');
    assert.equal(first.status, 200); assert.equal(first.completed, true);
    assert.equal(first.durationMs, 300);
    assert.equal(first.phase, 'view.compileWorkspace');
    assert.ok(first.reasons.includes('incomplete-scan'));
    assert.ok(first.reasons.includes('source-changed'));
    assert.ok(first.reasons.includes('native-artifact-mismatch'));
    assert.ok(first.phases.length <= 17);
    const raw = JSON.parse(lines[0]!.replace(/^Concord view slow request /u, '')) as { caches: unknown };
    assert.deepEqual(raw.caches, { annotations: { status: 'unavailable', failure: 'unknown' }, code: { status: 'unavailable', hits: 12, misses: 3, failure: 'HawdbBusy' } });
    const last = parse(lines.at(-1)!);
    assert.equal(last.route, '/api/unknown'); assert.equal(last.suppressed, 5);
    for (const line of lines) { assert.ok(Buffer.byteLength(line) < 4096); assert.doesNotMatch(line, /secret|untrusted/u); }
    brokenSink = true;
    await request(); // Logging failures cannot turn successful HTTP work into failures.
  } finally {
    log.close(); server.closeIdleConnections();
    await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
  }
})));
