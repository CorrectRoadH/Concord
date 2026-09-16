import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { Effect } from 'effect';
import { mutateTraceFiles, withTraceReadLease } from '../trace/relation-mutation.js';
import { ResearchConflictError, ResearchFileError, ResearchPathError, researchErrorMessage, type ResearchError } from './errors.js';

export interface NewPublication { readonly target: string; readonly digest: string }
export function sha256(value: string): string { return 'sha256:' + createHash('sha256').update(value).digest('hex'); }
function target(root: string, relativeTarget: string): string {
  const absolute = resolve(root, relativeTarget); const relation = relative(resolve(root), absolute);
  if (relation === '' || relation === '..' || relation.startsWith('..' + sep) || relativeTarget.includes('\\') || relation !== relativeTarget) throw new ResearchPathError({ path: relativeTarget, message: 'Research requires a canonical repository path.' });
  let cursor: string = sep;
  for (const part of absolute.slice(1).split(sep)) {
    cursor = resolve(cursor, part);
    try { if (lstatSync(cursor).isSymbolicLink()) throw new ResearchPathError({ path: relativeTarget, message: 'Research paths cannot contain symbolic links.' }); }
    catch (cause) { if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') break; throw cause; }
  }
  return absolute;
}
function ensureNewTarget(root: string, relativeTarget: string, directory: boolean): string {
  const absolute = target(root, relativeTarget);
  const directoryPath = directory ? resolve(absolute, '..') : absolute;
  if (directory && existsSync(directoryPath)) throw new ResearchConflictError({ path: relativeTarget, message: 'Research package directory already exists and cannot be implicitly claimed.' });
  if (!directory && existsSync(absolute)) throw new ResearchConflictError({ path: relativeTarget, message: 'Research target already exists.' });
  return absolute;
}
function publish(root: string, relativeTarget: string, content: Effect.Effect<string, ResearchError>, dryRun: boolean, directory = false): Effect.Effect<NewPublication, ResearchError> {
  let digest = '';
  const prepare = Effect.gen(function*() {
    // Template, package parent and destination reads all happen under the same lease.
    const bytes = yield* content;
    const absolute = yield* Effect.try({ try: () => ensureNewTarget(root, relativeTarget, directory), catch: cause => cause instanceof ResearchConflictError ? cause : new ResearchPathError({ path: relativeTarget, message: researchErrorMessage(cause) }) });
    digest = sha256(bytes);
    return [{ path: relativeTarget, bytes, expectedDigest: null }];
  });
  const operation = dryRun ? withTraceReadLease(root, () => prepare).pipe(Effect.asVoid) : mutateTraceFiles({ root, operation: 'research-publish', prepareUnderLease: prepare }).pipe(Effect.asVoid);
  return operation.pipe(Effect.map(() => ({ target: relativeTarget, digest })));
}
export function publishNewFile(root: string, path: string, content: Effect.Effect<string, ResearchError>, dryRun: boolean) { return publish(root, path, content, dryRun); }
export function publishNewDirectory(root: string, path: string, content: Effect.Effect<string, ResearchError>, dryRun: boolean) { return publish(root, `${path}/README.md`, content, dryRun, true).pipe(Effect.map(result => ({ ...result, target: path }))); }
export function readResearchFile(root: string, path: string): Effect.Effect<string, ResearchFileError | ResearchPathError> {
  return Effect.try({ try: () => readFileSync(target(root, path), 'utf8'), catch: cause => cause instanceof ResearchPathError ? cause : new ResearchFileError({ operation: 'read', path, message: researchErrorMessage(cause) }) });
}

export function readResearchFileIfPresent(root: string, path: string): Effect.Effect<string | undefined, ResearchFileError | ResearchPathError> {
  return Effect.try({
    try: () => {
      try {
        return readFileSync(target(root, path), "utf8");
      } catch (cause) {
        if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return undefined;
        throw cause;
      }
    },
    catch: cause => cause instanceof ResearchPathError
      ? cause
      : new ResearchFileError({ operation: "read", path, message: researchErrorMessage(cause) }),
  });
}
