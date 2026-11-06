import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from '../support/temporary.ts';
import { join } from 'node:path';
import { Effect } from 'effect';
import type { BrowserProvider } from '@e2e-dev/web';

/** The runner owns the process; workers receive only its CDP address. */
export function localBrowser(executable: string): BrowserProvider {
  const owned = new Map<string, ChildProcess>();
  const close = (id: string) => Effect.runPromise(Effect.tryPromise(async () => {
    const child = owned.get(id);
    try {
      if (child && child.exitCode === null && child.signalCode === null) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
          child.once('close', () => { clearTimeout(timer); resolve(); });
          child.once('error', error => { clearTimeout(timer); reject(error); });
          child.kill('SIGTERM');
        });
      }
    } finally {
      owned.delete(id);
      await rm(id, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }));
  return {
    name: 'Concord local Chromium',
    acquire: ({ signal }) => Effect.runPromise(Effect.tryPromise(async () => {
      signal.throwIfAborted();
      const id = await mkdtemp(join(tmpdir(), 'concord-e2e-browser-'));
      try {
        const child = spawn(executable, ['--headless', '--no-sandbox', '--disable-dev-shm-usage',
          '--enable-unsafe-swiftshader', '--remote-debugging-address=127.0.0.1',
          '--remote-debugging-port=0', `--user-data-dir=${id}`, 'about:blank'],
        { stdio: ['ignore', 'ignore', 'pipe'] });
        owned.set(id, child);
        const cdpEndpoint = await new Promise<string>((resolve, reject) => {
          let output = '';
          const done = (error?: Error, endpoint?: string) => {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            child.off('error', failed);
            child.off('exit', exited);
            child.stderr!.off('data', data);
            if (error) reject(error); else resolve(endpoint!);
          };
          const abort = () => done(new Error('Chromium startup cancelled'));
          const failed = (error: Error) => done(error);
          const exited = () => done(new Error('Chromium exited before CDP became ready'));
          const data = (chunk: Buffer) => {
            output = (output + chunk.toString()).slice(-8192);
            const endpoint = /DevTools listening on (ws:\/\/[^\s]+)/u.exec(output)?.[1];
            if (endpoint) done(undefined, endpoint);
          };
          const timer = setTimeout(() => done(new Error('Chromium startup timed out')), 15000);
          signal.addEventListener('abort', abort, { once: true });
          child.once('error', failed);
          child.once('exit', exited);
          child.stderr!.on('data', data);
          if (signal.aborted) abort();
        });
        return { id, cdpEndpoint };
      } catch (cause) { await close(id); throw cause; }
    })),
    release: lease => close(lease.id),
    async sweep() {
      const ids = [...owned.keys()];
      const results = await Promise.allSettled(ids.map(close));
      const failed = results.filter(result => result.status === 'rejected');
      if (failed.length) throw new AggregateError(failed.map(result => result.reason), 'Chromium cleanup failed');
      return ids;
    },
  };
}
