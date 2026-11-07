// @concord-file
// @concord-implements docs/feature/web-workbench/cli.md#校验产物
import { Effect, FileSystem, Schema, SchemaIssue } from 'effect';
import { join } from 'node:path';
import { ChangePreviewSchema, PREVIEW_DATA_LIMIT, ConcordError } from '../model/index.ts';

export const verifyChangePreview = Effect.fn('ChangePreview.verify')(function*(directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const invalid = (path: string, message: string) => new ConcordError('PreviewDirectoryInvalid', message, { path });
  const inspect = Effect.fn('ChangePreview.inspect')(function*(path: string, expected?: 'Directory' | 'File') {
    const link = yield* fs.readLink(path).pipe(Effect.result);
    if (link._tag === 'Success') return yield* Effect.fail(invalid(path, 'Preview must not contain symbolic links'));
    const info = yield* fs.stat(path).pipe(Effect.mapError(cause => invalid(path, cause.message)));
    if (expected ? info.type !== expected : info.type !== 'Directory' && info.type !== 'File') return yield* Effect.fail(invalid(path, 'Unexpected preview entry type'));
    return info;
  });
  yield* inspect(directory, 'Directory');
  const entries = yield* fs.readDirectory(directory).pipe(Effect.mapError(cause => invalid(directory, cause.message)));
  const expected = ['FONT-LICENSE.html', 'assets', 'changes.json', 'index.html'];
  const unexpected = entries.find(name => !expected.includes(name)) ?? expected.find(name => !entries.includes(name));
  if (unexpected !== undefined) return yield* Effect.fail(invalid(join(directory, unexpected), 'Preview directory must contain exactly the exported files'));
  for (const name of expected) yield* inspect(join(directory, name), name === 'assets' ? 'Directory' : 'File');
  const pending = [join(directory, 'assets')];
  while (pending.length) {
    const path = pending.pop()!;
    const children = yield* fs.readDirectory(path).pipe(Effect.mapError(cause => invalid(path, cause.message)));
    for (const name of children) {
      const child = join(path, name);
      if ((yield* inspect(child)).type === 'Directory') pending.push(child);
    }
  }
  const dataPath = join(directory, 'changes.json');
  const dataInvalid = (message: string, path = 'changes.json') => new ConcordError('PreviewDataInvalid', message, { path });
  if (Number((yield* fs.stat(dataPath)).size) > PREVIEW_DATA_LIMIT) return yield* Effect.fail(dataInvalid('changes.json exceeds its byte budget'));
  const source = yield* fs.readFileString(dataPath).pipe(Effect.mapError(cause => dataInvalid(cause.message)));
  if (Buffer.byteLength(source) > PREVIEW_DATA_LIMIT) return yield* Effect.fail(dataInvalid('changes.json exceeds its byte budget'));
  const value = yield* Effect.try({ try: () => JSON.parse(source) as unknown, catch: cause => dataInvalid(String(cause)) });
  const decoded = Schema.decodeUnknownResult(ChangePreviewSchema, { onExcessProperty: 'error' })(value);
  if (decoded._tag === 'Failure') {
    const issue = SchemaIssue.makeFormatterStandardSchemaV1()(decoded.failure.issue).issues[0]!;
    const path = (issue.path ?? []).map((part, index) => typeof part === 'number' ? `[${part}]` : `${index === 0 ? '' : '.'}${typeof part === 'object' ? String(part.key) : String(part)}`).join('');
    return yield* Effect.fail(dataInvalid(issue.message, path || 'changes.json'));
  }
  return { operation: 'view-verify', directory, comparison: decoded.success.comparison, files: decoded.success.entries.length };
});
