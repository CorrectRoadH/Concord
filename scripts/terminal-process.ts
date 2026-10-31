import { spawn } from 'node:child_process';
import { Effect } from 'effect';

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export const terminalText = (value: string) => value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/gu, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, '');

/** A real PTY supplied by the host's script utility; stdin remains interactive. */
export const openTerminal = Effect.fn('openTerminal')(function*(argv: readonly string[], cwd: string, env: NodeJS.ProcessEnv = {}, columns = 100, rows = 32) {
  const startedAt = performance.now();
  const handle = yield* Effect.acquireRelease(Effect.sync(() => {
    const command = `stty cols ${columns} rows ${rows}; exec ${argv.map(quote).join(' ')}`;
    const args = process.platform === 'darwin' ? ['-q', '/dev/null', '/bin/sh', '-c', command] : ['-qefc', command, '/dev/null'];
    const child = spawn('script', args, { cwd, env: { ...process.env, TERM: 'xterm-256color', NO_COLOR: '1', ...env }, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', ended = false;
    const listeners = new Set<() => void>();
    const notify = () => { for (const listener of listeners) listener(); };
    child.stdout.on('data', (chunk: Buffer) => { output = (output + chunk.toString()).slice(-2 * 1024 * 1024); notify(); });
    child.stderr.on('data', (chunk: Buffer) => { output = (output + chunk.toString()).slice(-2 * 1024 * 1024); notify(); });
    const exited = new Promise<void>(resolve => child.once('close', () => { ended = true; notify(); resolve(); }));
    child.once('error', cause => { output += String(cause); ended = true; notify(); });
    return { child, exited, listeners, text: () => terminalText(output), ended: () => ended };
  }), handle => Effect.gen(function*() {
    if (!handle.ended()) handle.child.stdin.write('q');
    const graceful = yield* Effect.result(Effect.promise(() => handle.exited).pipe(Effect.timeout('3 seconds')));
    if (graceful._tag === 'Failure') {
      try { process.kill(-handle.child.pid!, 'SIGKILL'); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause; }
      yield* Effect.promise(() => handle.exited);
    }
  }));
  return {
    startedAt, text: handle.text, send: (value: string) => Effect.sync(() => { handle.child.stdin.write(value); }),
    waitFor: (text: string, offset = 0) => Effect.tryPromise({ try: signal => new Promise<number>((resolve, reject) => {
      const cleanup = () => { handle.listeners.delete(check); signal.removeEventListener('abort', abort); };
      const check = () => {
        if (handle.text().slice(offset).includes(text)) { cleanup(); resolve(performance.now()); }
        else if (handle.ended()) { cleanup(); reject(new Error(`Terminal closed before ${text}: ${handle.text()}`)); }
      };
      const abort = () => { cleanup(); reject(signal.reason); };
      handle.listeners.add(check); signal.addEventListener('abort', abort, { once: true }); check();
    }), catch: cause => cause instanceof Error ? cause : new Error(String(cause)) }).pipe(Effect.timeout('15 seconds')),
  };
});
