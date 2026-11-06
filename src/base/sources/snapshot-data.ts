import type { Repository } from '../../model/index.ts';

/** Scoped source views can also be virtual Git/overlay inputs without OS metadata. */
export function snapshotBytes(repo: Repository, path: string): Uint8Array | undefined {
  if (repo.readBytes !== undefined) return repo.readBytes(path);
  const source = repo.read(path);
  return source === undefined ? undefined : new TextEncoder().encode(source);
}
export function snapshotMetadata(repo: Repository, path: string): ReturnType<NonNullable<Repository['inspect']>> {
  if (repo.inspect !== undefined) return repo.inspect(path);
  const bytes = snapshotBytes(repo, path);
  return bytes === undefined ? undefined : { file: true, directory: false, symbolicLink: false, size: bytes.byteLength, mode: 0o100644, identity: 'virtual' };
}
export const snapshotEnvironment = (repo: Repository, names: readonly string[]): Readonly<Record<string, string | undefined>> => repo.environment?.(names) ?? {};
