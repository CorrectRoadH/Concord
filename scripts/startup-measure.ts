import { spawnSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg, uptime } from 'node:os';
import { resolve } from 'node:path';
import { Effect } from 'effect';

// Compare fresh processes against the preserved pre-change distribution. Both
// variants use the same consumer, rendering environment and compile-cache mode.
Effect.runSync(Effect.sync(() => {
  const baseline = resolve('.test-results/startup-baseline/dist/entry.js');
  const candidate = resolve('dist/entry.js');
  const consumer = resolve('.test-results/startup-consumer');
  const cached = process.argv.includes('--compile-cache');
  const environment: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', TERM: 'dumb', NODE_OPTIONS: '' };
  delete environment.FORCE_COLOR;
  if (cached) {
    delete environment.NODE_DISABLE_COMPILE_CACHE;
    environment.NODE_COMPILE_CACHE = resolve('.test-results/startup-compile-cache');
  } else {
    environment.NODE_DISABLE_COMPILE_CACHE = '1';
    delete environment.NODE_COMPILE_CACHE;
  }
  const results: Record<string, Record<string, number[]>> = {};
  const started = new Date().toISOString();
  const startLoad = loadavg(), startUptimeSeconds = uptime();
  const stdoutPath = resolve('.test-results/startup-measure-stdout');
  const stderrPath = resolve('.test-results/startup-measure-stderr');
  for (const [name, args] of [['version', ['--version']], ['help', ['--help']], ['memory-index', ['memory', 'index', '--root', consumer, '--json']]] as const) {
    const samples: Record<string, number[]> = { baseline: [], candidate: [] };
    for (let round = -2; round < 9; round++) {
      const variants = round % 2 === 0 ? [['baseline', baseline], ['candidate', candidate]] : [['candidate', candidate], ['baseline', baseline]];
      for (const [variant, entry] of variants) {
        const stdout = openSync(stdoutPath, 'w'), stderr = openSync(stderrPath, 'w');
        try {
          const start = performance.now();
          const result = spawnSync(process.execPath, [entry!, ...args], { env: environment, stdio: ['ignore', stdout, stderr], timeout: 30_000 });
          const elapsed = performance.now() - start;
          if (result.error || result.status !== 0) throw new Error(`${name}/${variant}: ${result.error ?? readFileSync(stderrPath, 'utf8')}`);
          if (round >= 0) samples[variant!]!.push(elapsed);
        } finally { closeSync(stdout); closeSync(stderr); }
      }
    }
    results[name] = samples;
  }
  const summary = Object.fromEntries(Object.entries(results).map(([name, variants]) => [name, Object.fromEntries(Object.entries(variants).map(([variant, samples]) => {
    const sorted = [...samples].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(samples.length / 2)]!;
    return [variant, { p50, max: sorted.at(-1), valid: sorted.at(-1)! <= 2 * p50, samples }];
  }))]));
  const output = { started, finished: new Date().toISOString(), startLoad, endLoad: loadavg(), startUptimeSeconds, endUptimeSeconds: uptime(), node: process.version, compileCache: cached ? 'warm, common explicit directory' : 'disabled', samples: 9, warmups: 2, consumer, summary };
  writeFileSync(`.test-results/startup-measure${cached ? '-cached' : ''}.json`, JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
}));
