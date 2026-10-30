export function markdownAnchor(line: string): string | undefined {
  const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line)?.[1];
  if (heading === undefined) return undefined;
  const explicit = /\s+\{#([A-Za-z][A-Za-z0-9_.:-]*)\}\s*$/u.exec(heading)?.[1];
  if (explicit !== undefined) return explicit;
  if (heading.includes("{#")) return undefined;
  return heading
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s/gu, "-");
}
