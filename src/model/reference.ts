import { ConcordError } from "./shared.ts";
export interface ParsedReference {
  readonly path: string;
  readonly anchor?: string;
  readonly ref: string;
}
export function parseReference(input: string): ParsedReference {
  if (typeof input !== 'string' || input.length === 0 || input.trim() !== input || input.startsWith('/') || input.includes('\\') || input.includes('\0')) {
    throw new ConcordError('InvalidReference', `Expected a canonical repository reference: ${String(input)}`);
  }
  const firstHash = input.indexOf('#');
  if (firstHash !== input.lastIndexOf('#')) throw new ConcordError('InvalidReference', `Reference has more than one anchor: ${input}`);
  const path = firstHash < 0 ? input : input.slice(0, firstHash);
  const anchor = firstHash < 0 ? undefined : input.slice(firstHash + 1);
  if (!path || path.endsWith('/') || path.includes('//') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new ConcordError('InvalidReference', `Expected a canonical repository reference: ${input}`);
  }
  if (anchor !== undefined && (!anchor || anchor.trim() !== anchor || /[#/?\\\s]/u.test(anchor))) {
    throw new ConcordError('InvalidReference', `Expected a canonical Markdown anchor: ${input}`);
  }
  return anchor === undefined ? { path, ref: input } : { path, anchor, ref: input };
}
