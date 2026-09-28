// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
/** Optional instrumentation shared by CLI measurements and HTTP requests. */
export interface ScanTiming {
  sync<A>(name: string, operation: () => A): A;
}

export function measureScan<A>(timing: ScanTiming | undefined, name: string, operation: () => A): A {
  return timing === undefined ? operation() : timing.sync(name, operation);
}
