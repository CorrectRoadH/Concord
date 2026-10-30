import { relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ConcordError, type Repository } from "../../model/shared.js";
export function sourceUri(repo: Repository, path: string): string { return pathToFileURL(repo.absolute(path)).href; }
export function uriPath(repo: Repository, uri: string): string;
export function uriPath(repo: Repository, uri: string, allowExternal: true): string | undefined;
export function uriPath(repo: Repository, uri: string, allowExternal = false): string | undefined {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'file:' || url.host !== '' || url.search !== '' || url.hash !== '') throw new Error('not a local file URI');
    const path = relative(repo.root, fileURLToPath(url)).split(sep).join('/');
    if (path.startsWith('../') || path === '..') {
      if (allowExternal) return undefined;
      throw new Error('URI escapes the repository');
    }
    if (path === '') throw new Error('URI is not a source file');
    repo.absolute(path);
    return path;
  } catch { throw new ConcordError('LanguageServerFailed', 'Server returned an unsafe file URI'); }
}
