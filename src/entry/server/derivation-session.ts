// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#进程与资源
import { Effect, Schema } from 'effect';
import { CacheDerivationBatch } from '../../model/index.js';
import { WorkspaceServerError } from './protocol.js';

interface Batch { readonly session: string; readonly chunks: Uint8Array[]; bytes: number }
/** Only a complete decoded batch can reach the persistent owner. */
export class DerivationSessions {
  private readonly clients = new Map<number, Batch>();
  private bytes = 0;
  disconnect(client: number) {
    this.bytes -= this.clients.get(client)?.bytes ?? 0;
    this.clients.delete(client);
  }
  apply(client: number, input: { action: 'begin' | 'append' | 'commit'; session: string; data?: Uint8Array }, merge: (batches: readonly CacheDerivationBatch[]) => Effect.Effect<void, unknown>) {
    return Effect.gen({ self: this }, function*() {
      const fail = (message: string) => new WorkspaceServerError({ code: 'WorkspaceServerInputLimit', message });
      if (input.action === 'begin') {
        if (this.clients.has(client) || input.data !== undefined) return yield* Effect.fail(fail('Invalid or duplicate cache derivation session'));
        this.clients.set(client, { session: input.session, chunks: [], bytes: 0 });
        return { status: 'begun' };
      }
      const batch = this.clients.get(client);
      if (!batch || batch.session !== input.session) return yield* Effect.fail(fail('Unknown cache derivation session'));
      if (input.action === 'append') {
        if (!input.data || batch.bytes + input.data.byteLength > 32 * 1024 * 1024 || this.bytes + input.data.byteLength > 64 * 1024 * 1024) {
          this.disconnect(client);
          return yield* Effect.fail(fail('Cache derivations exceed their input allowance'));
        }
        batch.chunks.push(input.data); batch.bytes += input.data.byteLength; this.bytes += input.data.byteLength;
        return { status: 'appended' };
      }
      this.disconnect(client);
      if (input.data !== undefined) return yield* Effect.fail(fail('Cache derivation commit cannot append data'));
      const batches = yield* Effect.try({ try: () => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(CacheDerivationBatch)), { onExcessProperty: 'error' })(new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(batch.chunks))), catch: () => fail('Invalid cache derivation batch') });
      yield* merge(batches);
      return { status: 'committed' };
    });
  }
}
