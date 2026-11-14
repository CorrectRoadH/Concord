// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/collect-native-tests.md#bind
import { ConcordError, digest, objectDigest, type AnnotatedCase, type Repository } from "../../model/index.ts";
import type { NativeBindingView, NativeCase, NativeManifest } from "../../model/index.ts";
import type { readNativeObservations } from "./test-adapters.ts";

export function bindNative(repo: Repository, marker: AnnotatedCase, manifest: NativeManifest): readonly string[] | undefined {
  const text = repo.read(marker.file);
  if (text === undefined) throw new ConcordError('InputChanged', 'Marked test file disappeared');
  const lines = text.split(/\r?\n/u);
  const groups = new Map<string, NativeCase[]>();
  for (const item of manifest.cases.filter(item => item.kind === 'leaf' && item.file === marker.file && item.range !== undefined)) {
    const range = item.range!;
    if (!manifest.capabilities.range || range.sourceDigest !== digest(text) || range.endLine > lines.length) throw new ConcordError('AdapterProtocolInvalid', 'Provider declaration range does not match current source');
    const key = objectDigest({ project: item.project, file: item.file, range, declaration: item.group === undefined ? { nativeId: item.nativeId } : { group: item.group } });
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const end = marker.markerEndLine ?? marker.line;
  const values = [...groups.values()];
  const contained = values.filter(group => group[0]!.range!.startLine <= marker.line && group[0]!.range!.endLine >= end);
  let candidates = contained.filter(group => !contained.some(other => other !== group && other[0]!.range!.startLine >= group[0]!.range!.startLine && other[0]!.range!.endLine <= group[0]!.range!.endLine && (other[0]!.range!.startLine !== group[0]!.range!.startLine || other[0]!.range!.endLine !== group[0]!.range!.endLine)));
  if (candidates.length === 0) {
    // A provider that includes trivia must include it in its reported range.
    // Otherwise only whitespace between the marker and declaration is safe.
    const following = values.filter(group => group[0]!.range!.startLine > end && lines.slice(end, group[0]!.range!.startLine - 1).every(line => line.trim() === ''));
    const nearest = Math.min(...following.map(group => group[0]!.range!.startLine));
    candidates = following.filter(group => group[0]!.range!.startLine === nearest);
  }
  if (candidates.length > 1) throw new ConcordError('AmbiguousNativeBinding', 'The source marker has multiple equally specific native declaration groups');
  const automatic = candidates[0]?.map(item => item.nativeId).sort();
  let explicit: readonly string[] | undefined;
  if (marker.native !== undefined) {
    const target = manifest.cases.filter(item => item.kind === 'leaf' && item.file === marker.file && item.nativeId === marker.native);
    if (target.length !== 1) throw new ConcordError('NativeBindingUnavailable', '@native must identify one currently collected leaf');
    const item = target[0]!;
    explicit = item.group === undefined ? [item.nativeId] : manifest.cases.filter(other => other.kind === 'leaf' && other.project === item.project && other.file === item.file && other.group === item.group && objectDigest(other.range) === objectDigest(item.range)).map(other => other.nativeId).sort();
  }
  if (automatic && explicit && objectDigest(automatic) !== objectDigest(explicit)) throw new ConcordError('NativeSelectorConflict', 'The explicit native selector disagrees with the declaration range binding');
  return automatic ?? explicit;
}

export function nativeBindings(repo: Repository, cases: readonly AnnotatedCase[], observations: ReturnType<typeof readNativeObservations>): readonly NativeBindingView[] {
  return cases.map(marker => {
    const adapter = repo.config.testAdapters?.find(item => item.include.some(root => marker.file === root || marker.file.startsWith(`${root}/`)));
    const matches = observations.filter(item => item.adapterId === adapter?.id);
    const unavailable = (current: boolean, gaps: readonly string[]): NativeBindingView => ({ testId: marker.id, current, complete: false, nativeCases: [], gaps: [...new Set(gaps)].sort() });
    if (matches.length === 0) return unavailable(false, ['NativeObservationUnavailable']);
    if (matches.length > 1) return unavailable(false, ['AmbiguousNativeBinding']);
    const observed = matches[0]!.observation;
    const gaps = [...observed.gaps, ...observed.value.completeness.gaps];
    if (!observed.current) return unavailable(false, [...gaps, 'NativeObservationStale']);
    if (!observed.value.capabilities.realCollection || !observed.value.capabilities.leaf) return unavailable(true, [...gaps, 'NativeBindingUnavailable']);
    try {
      const ids = bindNative(repo, marker, observed.value);
      if (!ids?.length) return unavailable(true, [...gaps, 'NativeBindingUnavailable']);
      const selected = observed.value.cases.filter(item => ids.includes(item.nativeId));
      if (selected.length !== ids.length || new Set(selected.map(item => item.nativeId)).size !== selected.length) return unavailable(true, [...gaps, 'AmbiguousNativeBinding']);
      return {
        testId: marker.id,
        current: true,
        complete: observed.complete && observed.value.completeness.complete,
        nativeCases: selected.sort((a, b) => a.nativeId.localeCompare(b.nativeId)).map(({ nativeId, project, file, kind, group, range, tags }) => ({ nativeId, project, file, kind, ...(group === undefined ? {} : { group }), ...(range === undefined ? {} : { range }), tags })),
        gaps: [...new Set(gaps)].sort(),
      };
    } catch (cause) {
      return unavailable(true, [...gaps, cause instanceof ConcordError ? cause.code : 'NativeBindingUnavailable']);
    }
  });
}
