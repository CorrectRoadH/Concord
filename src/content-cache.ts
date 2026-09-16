/** Bounded process-local cache for pure parsers, never filesystem inventory or authorization.
 * Callers still read and validate current source bytes on every request.
 */
export class ContentCache<A> {
  private readonly entries = new Map<string, { source: string; value: A; size: number }>();
  private bytes = 0;

  constructor(private readonly limit = 16 * 1024 * 1024) {}

  get(path: string, source: string, parse: () => A): A {
    const prior = this.entries.get(path);
    if (prior?.source === source) {
      this.entries.delete(path);
      this.entries.set(path, prior);
      return structuredClone(prior.value);
    }
    const value = parse();
    if (prior) { this.entries.delete(path); this.bytes -= prior.size; }
    const size = 2 * (path.length + source.length + JSON.stringify(value ?? null).length);
    if (size <= this.limit) {
      while (this.bytes + size > this.limit || this.entries.size >= 10000) {
        const oldest = this.entries.keys().next().value;
        if (oldest === undefined) break;
        this.bytes -= this.entries.get(oldest)!.size;
        this.entries.delete(oldest);
      }
      this.entries.set(path, { source, value: structuredClone(value), size });
      this.bytes += size;
    }
    return value;
  }
}
