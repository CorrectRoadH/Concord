import { Effect } from 'effect';
import { startViewServer as start, type ViewServerHandle } from '../../dist/view-server.js';

/** End fixture-owned HTTP connections without discarding the engine's failure screenshot. */
export const startViewServer = (options: Parameters<typeof start>[0]): Promise<ViewServerHandle> =>
  Effect.runPromise(Effect.tryPromise(async () => {
    const server = await start(options);
    return { ...server, close: () => {
      const closing = server.close();
      // Chromium can hold a speculative connection that never sent an HTTP request.
      // closeIdleConnections alone cannot drain that connection on Node.
      server.server.closeAllConnections();
      return closing;
    } };
  }));
