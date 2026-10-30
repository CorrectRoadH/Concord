import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { Effect } from 'effect';
import { cachePhysicalBytes } from "../src/base/cache/index.js";

// Manual fresh-process measurements; never part of the test discovery pattern.
Effect.runSync(Effect.sync(() => {
  const [entry, root, output, baselineEntry, baselineRoot] = process.argv.slice(2);
  if (entry === undefined || root === undefined || output === undefined) throw new Error('entry, independent clone, and output path are required');
  const load = () => execFileSync('uptime', [], { encoding: 'utf8' }).trim();
  const artifacts = [{ label: 'candidate', entry, root }, ...(baselineEntry === undefined || baselineRoot === undefined ? [] : [{ label: 'baseline', entry: baselineEntry, root: baselineRoot }])];
  const groups = [['check'], ['docs', 'check'], ['memory', 'index']];
  const results = groups.map(args => {
    const invoke = (artifact: typeof artifacts[number]) => {
      const start = performance.now();
      const result = spawnSync(process.execPath, [artifact.entry, '--root', artifact.root, '--json', ...args], { cwd: artifact.root, encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
      const ms = performance.now() - start;
      if (result.status !== 0) throw new Error(`${args.join(' ')}: ${result.status}: ${result.stderr}\n${result.stdout.slice(0, 4000)}`);
      return ms;
    };
    for (const artifact of artifacts) invoke(artifact);
    const samples = new Map(artifacts.map(artifact => [artifact.label, [] as number[]]));
    const before = load();
    for (let index = 0; index < 9; index++) for (const artifact of index % 2 === 0 ? artifacts : [...artifacts].reverse()) samples.get(artifact.label)!.push(invoke(artifact));
    return { args: ['--json', ...args], uptimeBefore: before, uptimeAfter: load(), measurements: artifacts.map(artifact => {
      const values = samples.get(artifact.label)!, ordered = [...values].sort((a, b) => a - b);
      return { label: artifact.label, samples: values, p50Ms: ordered[4], maxMs: ordered.at(-1) };
    }) };
  });
  const report = { results, artifacts: artifacts.map(artifact => ({ ...artifact, commit: execFileSync('git', ['-C', artifact.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), physicalBytes: cachePhysicalBytes(`${artifact.root}/.git/concord`) })) };
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}));
