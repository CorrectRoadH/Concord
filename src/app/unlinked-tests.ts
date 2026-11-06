// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/find-unlinked-tests.md#list
import { bindNative, readNativeObservations } from '../domain/tests/index.ts';
import type { AnnotatedCase, Repository } from '../model/index.ts';

/** Reads collected observations only; trace queries never run a test adapter. */
export function unlinkedTests(repo: Repository, markers: readonly AnnotatedCase[]) {
  const limitations: string[] = [];
  if (!repo.config.testAdapters?.length) return { limitations: ['Run test discover with a configured adapter before inspecting unlinked native tests.'] };
  const observed = readNativeObservations(repo);
  const observations = observed.filter(item => item.observation.value.capabilities.realCollection);
  for (const item of observed.filter(item => !item.observation.value.capabilities.realCollection)) limitations.push(`${item.adapterId}: the adapter did not collect a real native test inventory.`);
  if (!observations.length) return { limitations: [...limitations, 'Run test discover with a capable adapter to collect the native test inventory before inspecting unlinked tests.'] };
  const missing = repo.config.testAdapters.filter(adapter => !observations.some(item => item.adapterId === adapter.id));
  if (missing.length) limitations.push(`Run test discover to collect missing adapter inventories: ${missing.map(adapter => adapter.id).join(', ')}.`);
  const stale = observations.some(item => !item.observation.current);
  if (stale) limitations.push('The native test inventory is stale. Only files with no current contract markers are listed; run test discover again for precise binding.');
  const tests: { path: string; nativeId: string; line?: number }[] = [];
  for (const { adapterId, observation } of observations) {
    const manifest = observation.value;
    const covered = new Set<string>();
    if (observation.current) {
      for (const marker of markers) {
        // Includes retired and Engineering declarations: neither is a missing link.
        if (!manifest.cases.some(item => item.file === marker.file)) continue;
        try { for (const id of bindNative(repo, marker, manifest) ?? []) covered.add(id); }
        catch (cause) { limitations.push(`${adapterId}: unable to bind ${marker.file}:${marker.line}: ${cause instanceof Error ? cause.message : String(cause)}`); }
      }
    }
    for (const item of manifest.cases) {
      if (item.kind !== 'leaf' || (observation.current ? covered.has(item.nativeId) : markers.some(marker => marker.file === item.file))) continue;
      tests.push({ path: item.file, nativeId: item.nativeId, ...(item.range ? { line: item.range.startLine } : {}) });
    }
  }
  tests.sort((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0) || a.nativeId.localeCompare(b.nativeId));
  // A combined inventory can include observations from more than one adapter;
  // expose the oldest collection time so its age is never understated.
  const collectedAt = observations.map(item => item.observation.observedAt).sort()[0]!;
  return { limitations, unlinkedTests: { collectedAt, stale, tests } };
}
