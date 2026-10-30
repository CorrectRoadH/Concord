


/** Mask metadata without moving any body offsets or line numbers. */
export function markdownBody(source: string): string {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, value => value.replace(/[^\r\n]/gu, ' '));
}
