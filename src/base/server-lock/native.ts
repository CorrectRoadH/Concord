/** Narrow N-API binding; directory creation and server lifecycle stay in TS. */
export interface NativeServerLock {
  verify(): void;
  identity(): unknown;
  close(): void;
}
export interface ServerLockBinding {
  nativeIdentity(): unknown;
  ServerLock: new (serverDirectory: string) => NativeServerLock;
}
