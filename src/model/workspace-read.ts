// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#协议
import { Schema } from 'effect';
import { ConcordError, digest } from './shared.js';
import { decodeUncachedDocumentSource } from './document-source.js';

const File = Schema.Struct({ path: Schema.String, digest: Schema.String, length: Schema.Int, diagnostics: Schema.Array(Schema.String) });
export const WorkspaceRead = Schema.Struct({
  envelope: Schema.Struct({ path: Schema.String, digest: Schema.String, files: Schema.Array(File) }),
  files: Schema.Array(Schema.Struct({ path: Schema.String, bytes: Schema.Uint8Array })),
}).annotate({ parseOptions: { onExcessProperty: 'error' } });
export type WorkspaceRead = typeof WorkspaceRead.Type;

/** Transport adapters share strict byte admission and the pure document decoder. */
export function decodeWorkspaceRead(input: WorkspaceRead) {
  const value = Schema.decodeUnknownSync(WorkspaceRead, { onExcessProperty: 'error' })(input);
  if (new TextEncoder().encode(JSON.stringify(value.envelope)).byteLength > 1024 * 1024 || value.envelope.files.length !== value.files.length || new Set(value.files.map(file => file.path)).size !== value.files.length) throw new ConcordError('WorkspaceServerInputLimit', 'Invalid read envelope');
  for (const file of value.files) {
    const descriptor = value.envelope.files.find(item => item.path === file.path);
    if (!descriptor || file.bytes.byteLength > 32 * 1024 * 1024 || descriptor.length !== file.bytes.byteLength || descriptor.digest !== digest(file.bytes)) throw new ConcordError('WorkspaceServerProtocol', 'Read bytes differ from their envelope');
  }
  const target = value.files.find(file => file.path === value.envelope.path);
  if (!target || digest(target.bytes) !== value.envelope.digest) throw new ConcordError('WorkspaceServerProtocol', 'Missing read target');
  const source = new TextDecoder('utf8', { fatal: true }).decode(target.bytes);
  let body = source, document: ReturnType<typeof decodeUncachedDocumentSource>;
  try { document = decodeUncachedDocumentSource(target.path, source); if (document) body = document.body; }
  catch { /* Invalid owners remain readable as raw source, as in /api/file. */ }
  return { path: target.path, digest: value.envelope.digest, body, ...(document ? { document } : {}) };
}
