// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#数据库-worker
import { parentPort } from 'node:worker_threads';
import { Schema } from 'effect';
import { DatabaseRequest, DatabaseReply, DatabaseValue } from './worker-protocol.ts';
import { createMemoryHawdb, openHawdb, acquireHawdbOwnerGate, acquireHawdbClearGuard, hawdbFailure, type NativeDatabase } from './hawdb-native.ts';
import { HawdbFailure } from './hawdb-types.ts';
import { cacheDatabasePath, deleteInspectedCache, inspectCacheClear } from './cache-file.ts';
import type { FileLock } from '../file-lock/index.ts';
import type { RuntimeEnvironmentSnapshot } from '../environment/index.ts';
import { writeCachePayloads } from './cache-query.ts';
import { mergeFeedbackRows } from './feedback-cache.ts';
import { inspectCacheStatus } from './cache-status.ts';
import { updateKnowledge, queryKnowledge, discardKnowledge } from './hawdb-search.ts';

let runtime: RuntimeEnvironmentSnapshot | undefined, privateDir: string | null = null;
let database: NativeDatabase | undefined, memory: NativeDatabase | undefined, gate: FileLock | undefined;
let identity: string | undefined, lastId = 0, closed = false;
let persistentError: HawdbFailure | undefined;
const persistent = () => {
  if (!database) throw persistentError ?? new HawdbFailure('HawdbUnavailable', 'Persistent database is unavailable');
  return database;
};
const transient = () => {
  if (!runtime) throw new HawdbFailure('HawdbUnavailable', 'Worker has not been initialized');
  return memory ??= createMemoryHawdb(runtime);
};
function execute(request: DatabaseRequest, check: () => void): DatabaseValue {
  const input = request.operation;
  if (input.op === 'close') {
    closed = true;
    database?.close(); memory?.close(); gate?.close();
    database = undefined; memory = undefined; gate = undefined;
    return null;
  }
  check();
  if (input.op === 'open') {
    if (runtime) throw new HawdbFailure('HawdbIncompatible', 'Worker is already initialized');
    runtime = input.runtime; privateDir = input.privateDir;
    if (privateDir === null) transient();
    else { gate = acquireHawdbOwnerGate(cacheDatabasePath(privateDir)); database = openHawdb(cacheDatabasePath(privateDir), { readOnly: false, create: true }, runtime, gate); }
    return null;
  }
  if (input.op === 'status') {
    if (!privateDir || !runtime) throw new HawdbFailure('HawdbUnavailable', 'No persistent cache');
    return inspectCacheStatus(privateDir, true, persistent, undefined, runtime);
  }
  if (input.op === 'clear') {
    if (!privateDir || !runtime) throw new HawdbFailure('HawdbUnavailable', 'No persistent cache');
    const path = cacheDatabasePath(privateDir);
    // Preflight before closing the live handle; keep Concord admission throughout.
    const inventory = inspectCacheClear(privateDir);
    if (!inventory.existing) return { status: 'empty', path };
    gate ??= acquireHawdbOwnerGate(path);
    database?.close(); database = undefined;
    memory?.close(); memory = undefined;
    const guard = acquireHawdbClearGuard(path, runtime, gate);
    try { check(); deleteInspectedCache(inspectCacheClear(privateDir), guard.verify); }
    finally { guard.close(); }
    database = openHawdb(path, { readOnly: false, create: true }, runtime, gate);
    persistentError = undefined;
    return { status: inventory.empty ? 'empty' : 'cleared', path };
  }
  const db = input.op === 'search' || input.op === 'discard-search' ? input.memory ? transient() : persistent() : persistent();
  return db.atomic(() => {
    let value: DatabaseValue;
    switch (input.op) {
      case 'read': value = input.keys === undefined ? [...db.scan(input.namespace)] : [...db.get(input.namespace, input.keys)]; break;
      case 'compare': {
        const prior = db.get(input.namespace, [input.key])[0]?.payload ?? null;
        value = prior === input.expected;
        if (value) { check(); db.put(input.namespace, [{ key: input.key, payload: input.payload }]); }
        break;
      }
      case 'derived': {
        for (const batch of input.batches) {
          check();
          if (batch.namespace === 'query_cache' && batch.entries.some(row => !row.key.startsWith('writing:'))) throw new HawdbFailure('HawdbIncompatible', 'Derived writes cannot overwrite historical observations');
          writeCachePayloads({ put: (namespace, rows, limits) => { check(); db.put(namespace, rows, limits); } }, batch.namespace, batch.entries);
        }
        value = null; break;
      }
      case 'feedback': value = [...mergeFeedbackRows(db, input.connectionId, input.items)]; break;
      case 'snapshot': value = Schema.decodeUnknownSync(DatabaseValue)(Object.fromEntries((['annotation_cache', 'code_cache', 'config_cache', 'feedback_cache', 'query_cache'] as const).map(namespace => { check(); return [namespace, [...db.scan(namespace)]]; }))); break;
      case 'search': {
        if (input.update) updateKnowledge(db, input.update, check);
        value = queryKnowledge(db, input.kind, input.generation, input.terms, check); break;
      }
      case 'discard-search': discardKnowledge(db, input.kind); value = null; break;
    }
    check();
    return value;
  }, check);
}
parentPort!.on('message', (raw: unknown) => {
  const request = Schema.decodeUnknownSync(DatabaseRequest, { onExcessProperty: 'error' })(raw);
  if (closed || request.id <= lastId || identity !== undefined && request.workerId !== identity || request.control.byteLength !== 4) throw new HawdbFailure('HawdbIncompatible', 'Worker request identity is invalid');
  identity = request.workerId; lastId = request.id;
  const check = () => {
    if (Atomics.load(new Int32Array(request.control), 0) !== 0 || process.hrtime.bigint() >= request.deadline) throw new HawdbFailure('HawdbCancelled', 'Database request was cancelled or exceeded its deadline');
  };
  let outcome: DatabaseReply['outcome'];
  try { const value = execute(request, check); if (request.operation.op !== 'close') check(); outcome = { ok: true, value }; }
  catch (cause) {
    const error = hawdbFailure(cause);
    if (request.operation.op === 'open' || request.operation.op === 'clear') persistentError = error;
    if (error.code === 'HawdbCommitUnknown') {
      // Do not replay the failed operation. Its caller must rediscover all sources.
      const prior = database; database = undefined;
      try { prior?.close(); if (privateDir && runtime && gate) database = openHawdb(cacheDatabasePath(privateDir), { readOnly: false, create: true }, runtime, gate); }
      catch (cause) { persistentError = hawdbFailure(cause); }
      memory?.close(); memory = undefined;
    }
    outcome = { ok: false, code: error.code, message: error.message };
  }
  parentPort!.postMessage(Schema.decodeUnknownSync(DatabaseReply, { onExcessProperty: 'error' })({ workerId: request.workerId, id: request.id, outcome }));
  if (closed) parentPort!.close();
});
