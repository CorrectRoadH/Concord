// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#进程与资源
import { Effect, Schema } from 'effect';
import { RemoteFeedbackSchema, type RemoteFeedback } from '../../model/index.ts';
import { WorkspaceServerError } from './protocol.ts';

interface Batch { readonly connectionId: string; items: RemoteFeedback[]; bytes: number }
/** Only unfinished input is retained; a disconnected client has no transaction. */
export class FeedbackSessions {
  private readonly connections = new Map<number, Map<string, Batch>>();
  disconnect(client: number) { this.connections.delete(client); }
  apply(client: number, input: { action: 'begin' | 'append' | 'commit'; session: string; connectionId?: string; items?: Schema.Json }, merge: (connectionId: string, items: readonly RemoteFeedback[]) => Effect.Effect<readonly string[], unknown>) {
    return Effect.gen({ self: this }, function*() {
      const fail = (message: string) => new WorkspaceServerError({ code: 'WorkspaceServerInputLimit', message });
      const sessions = this.connections.get(client) ?? new Map<string, Batch>();
      this.connections.set(client, sessions);
      if (input.action === 'begin') {
        if (!input.connectionId || input.items !== undefined || sessions.has(input.session) || sessions.size >= 8) return yield* Effect.fail(fail('Invalid or duplicate feedback session'));
        sessions.set(input.session, { connectionId: input.connectionId, items: [], bytes: 0 });
        return { status: 'begun' };
      }
      const batch = sessions.get(input.session);
      if (!batch) return yield* Effect.fail(fail('Unknown feedback session'));
      if (input.action === 'append') {
        const items = yield* Schema.decodeUnknownEffect(Schema.Array(RemoteFeedbackSchema), { onExcessProperty: 'error' })(input.items).pipe(Effect.mapError(cause => fail(String(cause))));
        const bytes = Buffer.byteLength(JSON.stringify(items));
        if (batch.items.length + items.length > 1000 || batch.bytes + bytes > 16 * 1024 * 1024 || [...sessions.values()].reduce((size, session) => size + session.bytes, bytes) > 32 * 1024 * 1024) {
          sessions.delete(input.session);
          return yield* Effect.fail(fail('Feedback batch exceeds its input allowance'));
        }
        batch.items.push(...items); batch.bytes += bytes;
        return { status: 'appended' };
      }
      sessions.delete(input.session);
      return { warnings: yield* merge(batch.connectionId, batch.items) };
    });
  }
}
