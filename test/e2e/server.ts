import { Effect } from 'effect';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startViewServer as start, type ViewServerHandle } from "../../src/entry/http/index.js";
import { packConcord, installConcord } from '../installed-package.js';

/** Source behavior uses the invocation's installed Web assets; the fixture owns both resources. */
export const startViewServer = (options: Parameters<typeof start>[0]): Promise<ViewServerHandle> =>
  Effect.runPromise(Effect.tryPromise(async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'concord-browser-assets-'));
    try {
      const install = join(scratch, 'tool'); mkdirSync(install);
      writeFileSync(join(install, 'package.json'), JSON.stringify({ private: true }));
      installConcord(install, packConcord(scratch));
      const server = await start({ ...options, webRoot: join(install, 'node_modules/concord-sdlc/dist/web') });
      return { ...server, close: async () => {
        const closing = server.close();
        server.server.closeAllConnections();
        try { await closing; } finally { rmSync(scratch, { recursive: true, force: true }); }
      } };
    } catch (cause) { rmSync(scratch, { recursive: true, force: true }); throw cause; }
  }));
