// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/analyze-other-languages.md
// @concord-implements docs/feature/local-sdlc/use-case/run-native-test-adapters.md
import { adapterFor, readNativeObservations } from './test-adapters.js';
import { bindNative } from './test-adapter-binding.js';
import { ConcordError, objectDigest, type AnnotatedCase, type Repository } from './shared.js';
import type { NativeAnalysisScope } from './analysis-values.js';

/** Called within the analysis source snapshot; never collects or starts a provider. */
export function captureNativeAnalysis(repo: Repository, cases: readonly AnnotatedCase[]) {
  const observations = readNativeObservations(repo);
  const identity = observations.map(item => ({
    adapterId: item.adapterId, current: item.observation.current, inputs: item.observation.inputs,
    manifestDigest: objectDigest(item.observation.value), versions: item.inputScope?.versions ?? null,
  })).sort((a, b) => a.adapterId.localeCompare(b.adapterId));
  const scopes = new Map<string, NativeAnalysisScope>();
  const gaps = new Map<string, readonly string[]>();
  for (const test of cases) {
    const adapter = adapterFor(repo, test.file);
    if (adapter === undefined) continue;
    const item = observations.find(item => item.adapterId === adapter.id && item.observation.current);
    if (item === undefined) { gaps.set(test.id, ['NativeObservationUnavailable']); continue; }
    const manifest = item.observation.value;
    try {
      const ids = bindNative(repo, test, manifest);
      const selected = ids?.map(id => manifest.cases.find(native => native.nativeId === id));
      if (!ids?.length || !manifest.capabilities.range || !selected?.every(native => native?.range !== undefined)) {
        gaps.set(test.id, [...manifest.completeness.gaps, 'NativeRangeUnavailable']);
        continue;
      }
      const ranges = selected.map(native => native!.range!);
      const firstRange = ranges[0]!, firstId = ids[0]!;
      scopes.set(test.id, {
        adapterId: adapter.id, manifestInputs: item.observation.inputs, manifestDigest: objectDigest(manifest),
        bindingVersion: 'concord.native-analysis-binding/v1', nativeIds: [firstId, ...ids.slice(1)], ranges: [firstRange, ...ranges.slice(1)],
        selectionDigest: objectDigest({ ids, selections: selected.map(native => native!.selection), ranges, versions: item.inputScope?.versions ?? null }),
        gaps: [...new Set([...item.observation.gaps, ...manifest.completeness.gaps])].sort(),
      });
    } catch (cause) {
      gaps.set(test.id, [...manifest.completeness.gaps, cause instanceof ConcordError ? cause.code : 'NativeBindingUnavailable']);
    }
  }
  return { identity, scopes, gaps };
}
