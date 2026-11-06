import { ConcordError } from "./shared.ts";
export function canonicalPath(path: string): string {
  if (!path || path.trim() !== path || path.startsWith('/') || /[\\\0\r\n]/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..') || path.includes('#')) throw new ConcordError('UnsafePath', `Expected a canonical repository-relative file path: ${path}`);
  return path;
}
