import { accessSync, constants, statSync } from 'node:fs';
import { tmpdir as systemTemporaryDirectory } from 'node:os';

/** Prefer the session tmpfs, then the Linux shared-memory filesystem. */
export function tmpdir(): string {
  for (const candidate of [process.env.XDG_RUNTIME_DIR, '/dev/shm']) {
    if (!candidate) continue;
    try {
      if (!statSync(candidate).isDirectory()) continue;
      accessSync(candidate, constants.W_OK | constants.X_OK);
      return candidate;
    } catch { /* Fall back to another writable temporary filesystem. */ }
  }
  return systemTemporaryDirectory();
}
