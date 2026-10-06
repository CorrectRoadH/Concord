import { Schema } from 'effect';

const Int = Schema.Int;
const CallFrame = Schema.Struct({ functionName: Schema.String, scriptId: Schema.String, url: Schema.String, lineNumber: Int, columnNumber: Int });
const ProfileNode = Schema.Struct({
  id: Int, callFrame: CallFrame, hitCount: Schema.optionalKey(Int), children: Schema.optionalKey(Schema.Array(Int)),
  deoptReason: Schema.optionalKey(Schema.String),
  positionTicks: Schema.optionalKey(Schema.Array(Schema.Struct({ line: Int, ticks: Int }))),
});
export const CpuProfile = Schema.Struct({
  nodes: Schema.Array(ProfileNode), startTime: Schema.Number, endTime: Schema.Number,
  samples: Schema.Array(Int), timeDeltas: Schema.Array(Schema.Number),
});
export type CpuProfile = typeof CpuProfile.Type;

export interface HotSpot { readonly name: string; readonly selfMs: number; readonly share: number }

/** Group a V8 file URL into the layer a reader acts on: Concord build, a dependency, or the runtime. */
export function layerOf(url: string): string {
  if (url === '') return '(native)';
  if (url.startsWith('node:')) return 'node:internal';
  const dependency = /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)\//u.exec(url);
  if (dependency) return dependency[1]!;
  const dist = /\/dist\/(.+)$/u.exec(url);
  return dist ? `dist/${dist[1]}` : url;
}

/** Self time per sample node, aggregated by function and by layer; idle and GC stay visible as their own rows. */
export function hotSpots(profile: CpuProfile, limit = 25): { totalMs: number; functions: HotSpot[]; layers: HotSpot[] } {
  if (profile.samples.length !== profile.timeDeltas.length) throw new Error('CPU samples and timeDeltas differ in length');
  const byId = new Map(profile.nodes.map(node => [node.id, node.callFrame]));
  const functions = new Map<string, number>(), layers = new Map<string, number>();
  let total = 0;
  profile.samples.forEach((id, index) => {
    const delta = profile.timeDeltas[index]! / 1000;
    const frame = byId.get(id);
    if (!frame) throw new Error(`CPU sample references absent node ${id}`);
    total += delta;
    const layer = layerOf(frame.url);
    const name = `${frame.functionName || '(anonymous)'} ${layer}:${frame.lineNumber + 1}`;
    functions.set(name, (functions.get(name) ?? 0) + delta);
    layers.set(layer, (layers.get(layer) ?? 0) + delta);
  });
  const rank = (entries: Map<string, number>) => [...entries].sort((a, b) => b[1] - a[1]).slice(0, limit)
    .map(([name, ms]) => ({ name, selfMs: Math.round(ms), share: total === 0 ? 0 : Math.round(ms / total * 1000) / 1000 }));
  return { totalMs: Math.round(total), functions: rank(functions), layers: rank(layers) };
}

/** V8 emits one file per thread; remap node identities before aggregating a process. */
export function combineProfiles(profiles: readonly CpuProfile[]): CpuProfile {
  if (profiles.length === 0) throw new Error('No CPU profiles for process');
  const nodes: CpuProfile['nodes'][number][] = [], samples: number[] = [], timeDeltas: number[] = [];
  let nextId = 1;
  for (const profile of profiles) {
    if (profile.samples.length !== profile.timeDeltas.length) throw new Error('CPU samples and timeDeltas differ in length');
    const ids = new Map(profile.nodes.map(node => [node.id, nextId++]));
    if (ids.size !== profile.nodes.length) throw new Error('Duplicate CPU node id');
    const remap = (id: number) => {
      const mapped = ids.get(id);
      if (mapped === undefined) throw new Error(`CPU profile references absent node ${id}`);
      return mapped;
    };
    nodes.push(...profile.nodes.map(node => ({ ...node, id: remap(node.id), ...(node.children ? { children: node.children.map(remap) } : {}) })));
    samples.push(...profile.samples.map(remap));
    timeDeltas.push(...profile.timeDeltas);
  }
  return { nodes, samples, timeDeltas, startTime: Math.min(...profiles.map(p => p.startTime)), endTime: Math.max(...profiles.map(p => p.endTime)) };
}
