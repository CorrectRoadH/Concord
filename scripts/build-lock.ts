import { randomUUID } from 'node:crypto';
import { createConnection, createServer, type Socket } from 'node:net';
import { Effect, Schema } from 'effect';

const Owner = Schema.fromJsonString(Schema.Struct({
  kind: Schema.Literal('concord-build-lock/v1'), pid: Schema.Int, startedAt: Schema.String, token: Schema.String,
}));
const port = 43197;
export class BuildLockFailed extends Schema.TaggedError<BuildLockFailed>()('BuildLockFailed', { detail: Schema.String }) {}
export interface BuildLock { readonly token: string; readonly release: () => Promise<void> }

/** The OS releases the machine-wide loopback lease even after SIGKILL. */
export const acquireBuildLock = (inherited = process.env.CONCORD_BUILD_LOCK, lockPort = port) => Effect.tryPromise({
  try: async (signal): Promise<BuildLock> => {
    for (;;) {
      signal.throwIfAborted();
      const owner = { kind: 'concord-build-lock/v1' as const, pid: process.pid, startedAt: new Date().toISOString(), token: randomUUID() };
      const clients = new Set<Socket>();
      const server = createServer(socket => {
        clients.add(socket);
        socket.on('error', () => socket.destroy());
        socket.once('close', () => clients.delete(socket));
        socket.write(`${JSON.stringify(owner)}\n`);
      });
      const listening = await new Promise<boolean>((resolve, reject) => {
        server.once('error', cause => (cause as NodeJS.ErrnoException).code === 'EADDRINUSE' ? resolve(false) : reject(cause));
        server.listen({ host: '127.0.0.1', port: lockPort, exclusive: true }, () => resolve(true));
      });
      if (listening) {
        const release = () => new Promise<void>((resolve, reject) => {
          for (const socket of clients) socket.destroy();
          server.close(cause => cause ? reject(cause) : resolve());
        });
        if (signal.aborted) { await release(); signal.throwIfAborted(); }
        return { token: owner.token, release };
      }
      const inheritedOwner = await new Promise<boolean>((resolve, reject) => {
        const socket = createConnection({ host: '127.0.0.1', port: lockPort });
        let buffer = '', recognized = false;
        const abort = () => { socket.destroy(); reject(signal.reason); };
        signal.addEventListener('abort', abort, { once: true });
        socket.once('close', () => { signal.removeEventListener('abort', abort); resolve(false); });
        socket.once('error', cause => {
          if ((cause as NodeJS.ErrnoException).code !== 'ECONNREFUSED') reject(cause);
          socket.destroy();
        });
        socket.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          if (recognized) return;
          if (buffer.length > 4096) { socket.destroy(); reject(new Error('Invalid build lock owner')); return; }
          if (!buffer.includes('\n')) return;
          try {
            const active = Schema.decodeUnknownSync(Owner, { onExcessProperty: 'error' })(buffer.trim());
            recognized = true;
            if (inherited === active.token) { resolve(true); socket.destroy(); }
            else console.error(`# Build lock: waiting for pid=${active.pid}; started=${active.startedAt}`);
          } catch (cause) { socket.destroy(); reject(cause); }
        });
        if (signal.aborted) abort();
      });
      if (inheritedOwner) return { token: inherited!, release: async () => {} };
    }
  },
  catch: cause => new BuildLockFailed({ detail: String(cause) }),
});
