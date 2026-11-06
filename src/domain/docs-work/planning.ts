import type { Item } from "../../model/index.ts";



export function ancestors(item: Item, items: readonly Item[]): Set<string> {
  const seen = new Set<string>();
  const pending = [...item.blockedBy];
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const dependency = items.find(candidate => candidate.id === id);
    if (dependency) pending.push(...dependency.blockedBy);
  }
  return seen;
}


export function changedInputs(before: readonly { path: string; digest: string | null }[], after: readonly { path: string; digest: string | null }[]): string[] {
  const old = new Map(before.map(entry => [entry.path, entry.digest]));
  const current = new Map(after.map(entry => [entry.path, entry.digest]));
  return [...new Set([...old.keys(), ...current.keys()])].filter(path => old.get(path) !== current.get(path)).sort();
}
