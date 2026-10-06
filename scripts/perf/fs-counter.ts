import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Effect from 'effect/Effect';

/** Profile preload: count invocations and synchronous call time without changing return values. */
Effect.runSync(Effect.sync(() => {
  const output = process.env.CONCORD_PERF_COUNTER_DIR;
  if (output === undefined) return;
  const write = fs.writeFileSync;
  const calls: Record<string, { count: number; ms: number }> = {};
  const root = process.env.CONCORD_PERF_COUNTER_ROOT;
  const classify = (value: unknown): string => {
    if (root === undefined) return 'unclassified';
    const path = typeof value === 'string' ? resolve(value) : Buffer.isBuffer(value) ? resolve(value.toString()) : value instanceof URL ? fileURLToPath(value) : undefined;
    if (path === undefined) return 'other';
    if (path === root || path.startsWith(`${root}${sep}`)) return 'inside';
    return root.startsWith(path.endsWith(sep) ? path : `${path}${sep}`) ? 'above' : 'other';
  };
  const wrap = (target: Record<string, unknown>, prefix: string) => {
    for (const [name, original] of Object.entries(target)) {
      if (typeof original !== 'function' || /^[A-Z]/u.test(name)) continue;
      const entry = calls[`${prefix}${name}`] = { count: 0, ms: 0 };
      const wrapped = function(this: unknown, ...args: unknown[]) {
        entry.count++;
        const category = prefix === '' && (name === 'readdirSync' || name === 'lstatSync')
          ? calls[`${name}.${classify(args[0])}`] ??= { count: 0, ms: 0 } : undefined;
        if (category !== undefined) category.count++;
        const started = performance.now();
        try { return Reflect.apply(original, this, args); }
        finally { const ms = performance.now() - started; entry.ms += ms; if (category !== undefined) category.ms += ms; }
      };
      // Preserve auxiliary APIs such as realpathSync.native and custom promisification.
      for (const key of Reflect.ownKeys(original)) {
        if (key === 'length' || key === 'name' || key === 'prototype' || key === 'caller' || key === 'arguments') continue;
        const descriptor = Object.getOwnPropertyDescriptor(original, key);
        if (descriptor) Object.defineProperty(wrapped, key, descriptor);
      }
      target[name] = wrapped;
    }
  };
  wrap(fs as unknown as Record<string, unknown>, '');
  wrap(fs.promises as unknown as Record<string, unknown>, 'promises.');
  syncBuiltinESMExports();
  const started = performance.now();
  process.once('exit', code => Effect.runSync(Effect.sync(() => {
    const usage = process.resourceUsage();
    write(join(output, `counter-${process.pid}.json`), JSON.stringify({
      pid: process.pid, ppid: process.ppid, argv: process.argv.slice(1), exitCode: code,
      wallMs: performance.now() - started, userMs: usage.userCPUTime / 1000, systemMs: usage.systemCPUTime / 1000,
      maxRssKiB: usage.maxRSS, fsRead: usage.fsRead, fsWrite: usage.fsWrite,
      voluntaryContextSwitches: usage.voluntaryContextSwitches, involuntaryContextSwitches: usage.involuntaryContextSwitches,
      fs: Object.fromEntries(Object.entries(calls).filter(([, value]) => value.count > 0)),
    }));
  })));
}));
