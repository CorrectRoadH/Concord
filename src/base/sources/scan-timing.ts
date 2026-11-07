// @concord-file
// @concord-implements docs/feature/web-workbench/architecture.md#项目测试只读投影
/** Optional instrumentation shared by CLI measurements and HTTP requests. */
export interface ScanTiming {
  sync<A>(name: string, operation: () => A): A;
  async<A>(name: string, operation: () => Promise<A>): Promise<A>;
}

export function measureScanAsync<A>(timing: ScanTiming | undefined, name: string, operation: () => Promise<A>): Promise<A> {
  return timing === undefined ? operation() : timing.async(name, operation);
}

export function measureScan<A>(timing: ScanTiming | undefined, name: string, operation: () => A): A {
  return timing === undefined ? operation() : timing.sync(name, operation);
}
