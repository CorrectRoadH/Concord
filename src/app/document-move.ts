// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/move-spec-documents.md#preview
// @concord-implements docs/feature/local-sdlc/use-case/move-spec-documents.md#apply
// @concord-implements docs/feature/local-sdlc/use-case/move-spec-documents.md#rename-package
// @concord-implements docs/feature/local-sdlc/use-case/move-spec-documents.md#check
import { Effect } from 'effect';
import { runGit } from '../base/git/index.ts';
import type { LocalRepository } from '../base/workspace/index.ts';
import { repositoryRuntime } from '../base/workspace/index.ts';
import { loadDocuments, relocateMarkdown, decodeDocumentSource, moveOwnerTargets } from '../domain/documents/index.ts';
import { moveTestTargets } from '../domain/tests/index.ts';
import { moveCodeTargets } from '../domain/code/index.ts';
import { ConcordError, canonicalPath, objectDigest, ownerKind, documentPlacementError, packagePageKind, inRepositorySnapshot, failure, type Repository, type DocumentMoveChange, type DocumentMovePlan } from '../model/index.ts';

const packageDirectory = (path: string) => path.split('/').slice(0, 3).join('/');

export async function planDocumentMove(repo: Repository, request: { readonly from: string; readonly to: string }): Promise<DocumentMovePlan> {
  const { from, to } = request;
  canonicalPath(from); canonicalPath(to);
  repo.absolute(from); repo.absolute(to);
  if (![from, to].every(path => /^docs\/(?:feature|engineering)\/[^/]+(?:\/|$)/u.test(path))) throw new ConcordError('InvalidInput', 'Move requires exact Feature or Engineering paths');
  const directory = from.split('/').length === 3;
  if (directory !== (to.split('/').length === 3)) throw new ConcordError('InvalidPlacement', 'A package must move to a package directory');
  const sources = directory ? repo.files(from).sort() : repo.readBytes?.(from) !== undefined || repo.read(from) !== undefined ? [from] : [];
  if (!sources.length || directory && !sources.includes(`${from}/README.md`)) throw new ConcordError('DocumentNotFound', from);
  if ((repo.exists?.(to) ?? false) || repo.files(to).length > 0 || repo.readBytes?.(to) !== undefined) throw new ConcordError('DocumentExists', to);
  if (!directory) {
    if ([from, to].some(path => path === `${packageDirectory(path)}/README.md`)) throw new ConcordError('InvalidInput', 'Move the complete package to move its README');
    if ((ownerKind(from) === 'use-case') !== (ownerKind(to) === 'use-case')) throw new ConcordError('InvalidInput', 'Move cannot change a Use Case into another page kind');
    if (!from.endsWith('.md') || !to.endsWith('.md')) throw new ConcordError('InvalidInput', 'Single-page move requires Markdown');
    if (repo.read(`${packageDirectory(to)}/README.md`) === undefined) throw new ConcordError('DocumentNotFound', packageDirectory(to));
  }
  const moves = sources.map(path => ({ from: path, to: directory ? to + path.slice(from.length) : to }));
  const mapping = new Map(moves.map(move => [move.from, move.to]));
  const mapPath = (path: string): string => mapping.get(path) ?? path;
  const mapReference = (reference: string): string => {
    const hash = reference.indexOf('#'), path = hash < 0 ? reference : reference.slice(0, hash);
    return mapPath(path) + (hash < 0 ? '' : reference.slice(hash));
  };
  const documents = loadDocuments(repo);
  const records = new Map(documents.map(doc => [doc.path, doc]));
  const targetPaths = new Set(repo.files(packageDirectory(to)).filter(path => !mapping.has(path)));
  moves.forEach(move => targetPaths.add(move.to));
  for (const move of moves) {
    repo.absolute(move.from); repo.absolute(move.to);
    if (repo.readBytes?.(move.to) !== undefined || repo.read(move.to) !== undefined) throw new ConcordError('DocumentExists', move.to);
    if (!move.from.endsWith('.md')) continue;
    const originalKind = packagePageKind(`${packageDirectory(from)}/README.md`, move.from, new Set(sources));
    if (directory && move.from.endsWith('/README.md') && move.from !== `${from}/README.md` && originalKind === 'unknown') throw new ConcordError('NestedOwner', move.from);
    const source = repo.read(move.from);
    if (source === undefined) throw new ConcordError('FileChangedSinceRead', move.from);
    const kind = ownerKind(move.to);
    const placement = kind === undefined ? undefined : documentPlacementError(kind, move.to, kind === 'use-case' ? `${packageDirectory(to)}/README.md` : undefined);
    if (placement !== undefined || packagePageKind(`${packageDirectory(to)}/README.md`, move.to, targetPaths) === 'unknown') throw new ConcordError('InvalidPlacement', placement ?? move.to);
    decodeDocumentSource(move.to, source, repositoryRuntime(repo));
  }
  const remainingPaths = new Set(repo.files(packageDirectory(from)).filter(path => !mapping.has(path)));
  const packagePaths = new Set([...targetPaths, ...remainingPaths]);
  for (const path of packagePaths) {
    if (!path.endsWith('.md')) continue;
    if (packagePageKind(`${packageDirectory(path)}/README.md`, path, packagePaths) === 'unknown') throw new ConcordError('InvalidPlacement', path);
  }
  const testFiles = [...new Set(repo.config.testRoots.flatMap(root => repo.files(root, 'source')))].sort();
  const codeFiles = [...new Set((repo.config.sourceRoots ?? []).flatMap(root => repo.files(root, 'source')))].sort();
  const paths = [...new Set([...repo.files('docs'), ...repo.files('memory'), ...testFiles, ...codeFiles, ...sources])].sort();
  const changes: DocumentMoveChange[] = [];
  const inputs: [string, string][] = [];
  for (const path of paths) {
    const moved = mapping.get(path);
    const markdown = (path.startsWith('docs/') || path.startsWith('memory/')) && path.endsWith('.md');
    if (!markdown && !moved && !testFiles.includes(path) && !codeFiles.includes(path)) continue;
    if (moved && !markdown) {
      const bytes = repo.readBytes?.(path);
      if (bytes === undefined) throw new ConcordError('FileChangedSinceRead', path);
      const image = Buffer.from(bytes).toString('base64');
      inputs.push([path, image]);
      changes.push({ path, before: image, after: null, encoding: 'base64' }, { path: moved, before: null, after: image, encoding: 'base64' });
      continue;
    }
    const record = records.get(path);
    const managed = record?.metadata.kind === 'issue' || record?.metadata.kind === 'memory' ? moveOwnerTargets(repo, record, mapReference) : undefined;
    const source = managed?.before ?? repo.read(path);
    if (source === undefined) throw new ConcordError('FileChangedSinceRead', path);
    inputs.push([path, source]);
    let after = managed?.after ?? source;
    if (markdown) {
      after = relocateMarkdown(after, path, moved ?? path, mapPath);
    }
    if (testFiles.includes(path)) after = await moveTestTargets(path, after, mapReference);
    if (codeFiles.includes(path)) after = await moveCodeTargets(path, after, repo.config, mapReference);
    if (moved) changes.push({ path, before: source, after: null }, { path: moved, before: null, after });
    else if (source !== after) changes.push({ path, before: source, after });
  }
  changes.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { ...request, moves, changes, inputsDigest: objectDigest({ root: repo.root, privateDir: repo.privateDir, config: repo.configSnapshot.source, sources, testFiles, codeFiles, inputs }) };
}

export const moveDocument = Effect.fn('moveDocument')(function*(repo: LocalRepository, from: string, to: string, dryRun = false) {
  const tracked = yield* runGit(repo.root, ['ls-files', '-z']);
  if (tracked.truncated) return yield* Effect.fail(new ConcordError('ReferenceScanIncomplete', 'Tracked file list exceeds budget'));
  return yield* Effect.tryPromise({ try: () => inRepositorySnapshot(repo, async () => {
    const plan = await planDocumentMove(repo, { from, to });
    const unmanagedReferences: { path: string; line: number }[] = [];
    const after = new Map(plan.changes.map(change => [change.path, change]));
    const destinations = new Map(plan.moves.map(move => [move.from, move.to]));
    const trackedPaths = [...new Set(tracked.stdout.split('\0').filter(Boolean).map(path => destinations.get(path) ?? path))].sort();
    for (const path of trackedPaths) {
      const change = after.get(path);
      let source: string | undefined;
      if (change) source = change.encoding === 'base64' ? undefined : change.after ?? undefined;
      else {
        let bytes: Uint8Array | undefined;
        try { bytes = repo.readBytes?.(path); }
        catch (cause) { if (!(cause instanceof ConcordError) || !['UnsafePath', 'InvalidFile'].includes(cause.code)) throw cause; }
        if (bytes !== undefined) try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* Non-text tracked files have no textual references. */ }
      }
      if (source === undefined || source.includes('\0')) continue;
      source.split('\n').forEach((line, index) => { if (line.includes(from)) unmanagedReferences.push({ path, line: index + 1 }); });
    }
    return { ...(await repo.publishDocumentMove(plan, dryRun)), moves: plan.moves, unmanagedReferences };
  }), catch: failure });
});
