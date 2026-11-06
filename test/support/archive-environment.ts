import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';

/** Keep only system base commands and Git; PATH runtime probes fail and record any fallback. */
export function archiveEnvironment(directory: string): { env: NodeJS.ProcessEnv; marker: string } {
  mkdirSync(directory, { recursive: true });
  for (const tool of ['git', 'dirname', 'readlink']) {
    const path = (process.env.PATH ?? '').split(delimiter).map(entry => resolve(entry, tool)).find(candidate => existsSync(candidate));
    assert.ok(path, `Archive acceptance needs the system command ${tool}`);
    symlinkSync(path, join(directory, tool));
  }
  const marker = join(directory, 'unexpected-runtime');
  const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
  for (const tool of ['node', 'rg', 'pnpm']) {
    writeFileSync(join(directory, tool), `#!/bin/sh\nprintf '%s\\n' '${tool}' >> ${quote(marker)}\nexit 97\n`);
    chmodSync(join(directory, tool), 0o755);
  }
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: directory, NODE_OPTIONS: '', NODE_PATH: '', LD_LIBRARY_PATH: '',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_') && !['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT'].includes(key)) delete env[key];
  return { env, marker };
}
