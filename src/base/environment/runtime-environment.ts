// @concord-file
// @concord-implements docs/engineering/testing/architecture.md#进程内-cli
import { userInfo } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { Context, Layer } from 'effect';

export interface RuntimeEnvironmentSnapshot {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** Composition roots take the snapshot; adapters never consult the host as a fallback. */
export function makeRuntimeEnvironment(cwd: string, env: Readonly<Record<string, string | undefined>>): RuntimeEnvironmentSnapshot {
  if (!isAbsolute(cwd)) throw new Error('Runtime environment cwd must be absolute');
  return Object.freeze({ cwd, env: Object.freeze({ ...env }) });
}

export class RuntimeEnvironment extends Context.Service<RuntimeEnvironment, RuntimeEnvironmentSnapshot>()('concord/base/environment/RuntimeEnvironment') {
  static layer(snapshot: RuntimeEnvironmentSnapshot) { return Layer.succeed(RuntimeEnvironment, makeRuntimeEnvironment(snapshot.cwd, snapshot.env)); }
}

export const runtimePath = (runtime: RuntimeEnvironmentSnapshot, path: string): string => resolve(runtime.cwd, path);
export const runtimeHome = (runtime: RuntimeEnvironmentSnapshot): string => runtimePath(runtime, runtime.env.HOME || runtime.env.USERPROFILE || userInfo().homedir);
export const runtimeCacheHome = (runtime: RuntimeEnvironmentSnapshot): string => runtimePath(runtime, runtime.env.XDG_CACHE_HOME || join(runtimeHome(runtime), '.cache'));
export const runtimeTemporaryDirectory = (runtime: RuntimeEnvironmentSnapshot): string => runtimePath(runtime, runtime.env.TMPDIR || runtime.env.TMP || runtime.env.TEMP || '/tmp');
