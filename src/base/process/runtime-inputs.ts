import { constants, closeSync, existsSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { ConcordError, digest, objectDigest } from '../../model/index.ts';
import { packageRoot } from '../installation/index.ts';

function inputBytes(path: string): Buffer {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink()) throw new ConcordError('InputChanged', 'Adapter input is not a regular file');
  const fd = openSync(path, constants.O_RDONLY | (process.platform === 'darwin' ? 0x20000000 : constants.O_NOFOLLOW) | constants.O_NONBLOCK);
  try {
    if (process.platform === 'linux' && readlinkSync(`/proc/self/fd/${fd}`) !== path) throw new ConcordError('InputChanged', 'Adapter input resolved outside its captured path');
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev) throw new ConcordError('InputChanged', 'Adapter input was replaced while opening');
    const bytes = readFileSync(fd), after = fstatSync(fd), linked = lstatSync(path);
    if (linked.isSymbolicLink() || linked.ino !== opened.ino || linked.dev !== opened.dev || after.size !== bytes.length || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new ConcordError('InputChanged', 'Adapter input changed while reading');
    return bytes;
  } finally { closeSync(fd); }
}

function implementation(): string {
  const entries: { path: string; digest: string }[] = [];
  const walk = (directory: string, prefix: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const target = join(directory, name), path = prefix ? `${prefix}/${name}` : name, stat = lstatSync(target);
      if (stat.isSymbolicLink()) throw new ConcordError('UnsafeToolInstallation', 'Concord implementation contains a symbolic link');
      if (stat.isDirectory()) walk(target, path);
      else if (stat.isFile() && /\.[cm]?js$/u.test(name)) entries.push({ path, digest: digest(inputBytes(target)) });
    }
  };
  walk(join(packageRoot, import.meta.url.endsWith('.ts') ? 'src/domain/tests' : 'dist/domain/tests'), '');
  return objectDigest(entries);
}

/** Observation-only runtime inputs for a source snapshot; this capability cannot launch a tool. */
export function adapterRuntimeInputs(root: string, command: string, envNames: readonly string[], environment: Readonly<Record<string, string | undefined>> = {}) {
  const candidates = command.includes('/') ? [resolve(root, command)] : (environment.PATH ?? '').split(delimiter).map(path => resolve(root, path, command));
  const found = candidates.find(path => existsSync(path) && lstatSync(path).isFile());
  const linked = candidates.find(path => { try { return readFileSync(path).length > 0; } catch { return false; } });
  if (!found && !linked) throw new ConcordError('CollectFailed', `Adapter executable is unavailable: ${command}`);
  const path = found ?? linked!;
  return { executable: { path, digest: digest(readFileSync(path)) }, env: Object.fromEntries(envNames.map(name => [name, environment[name]])), implementation: implementation(), version: process.version };
}
