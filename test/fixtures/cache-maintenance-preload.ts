import { appendFileSync } from 'node:fs';

const trace = process.env.CONCORD_TEST_RECLAIM_TRACE;
const event = (kind: string) => { if (trace) appendFileSync(trace, JSON.stringify({ kind, pid: process.pid, argv: process.argv }) + '\n'); };
if (process.argv.some(value => /compute-worker\.(ts|js)$/.test(value))) event('compute-start');
const original = process.dlopen;
process.dlopen = new Proxy(original, { apply(target, receiver, args: Parameters<typeof process.dlopen>) {
  const result = Reflect.apply(target, receiver, args);
  const exports: unknown = Reflect.get(args[0], 'exports');
  if (typeof exports === 'object' && exports !== null) {
    const bridge: unknown = Reflect.get(exports, 'CacheBridge');
    if (typeof bridge === 'function') {
      const prototype: unknown = Reflect.get(bridge, 'prototype');
      if (typeof prototype === 'object' && prototype !== null) {
        const reclaim: unknown = Reflect.get(prototype, 'reclaim');
        if (typeof reclaim === 'function') Reflect.set(prototype, 'reclaim', function(this: unknown, ...input: unknown[]) {
          const report: unknown = Reflect.apply(reclaim, this, input);
          event('reclaimed');
          return report;
        });
      }
    }
  }
  return result;
} });
