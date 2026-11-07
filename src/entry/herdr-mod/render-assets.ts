// @concord-file
// @concord-implements docs/feature/herdr-mod/architecture.md#界面
import { mkdir, unlink, writeFile } from 'fs/promises';
import { Buffer } from 'buffer';
import { createHash } from 'crypto';
import { Schema } from 'effect';
import type { AsyncContext, Task } from 'gpui-kit';
import { appHome, shared, setShared } from 'herdr';
import type { RenderedPage } from '../../model/herdr-mod/index.ts';
import { ModFailure } from './session.ts';

const KEY = 'concord.render.assets';
const LIFETIME = 15_000;
const Filename = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}\.(?:png|jpg|gif|webp|svg|html)$/u));
const State = Schema.Struct({
  next: Schema.Int,
  owners: Schema.Record(Schema.String, Schema.Number),
  leases: Schema.Record(Schema.String, Schema.Struct({ owner: Schema.String, files: Schema.Array(Filename) })),
  retired: Schema.Array(Filename),
  lock: Schema.NullOr(Schema.Struct({ owner: Schema.String, token: Schema.String })),
});
type State = { next: number; owners: Record<string, number>; leases: Record<string, { owner: string; files: readonly string[] }>; retired: readonly string[]; lock: { owner: string; token: string } | null };
const state = (): State => {
  const value = shared(KEY);
  return value === null || value === undefined ? { next: 0, owners: {}, leases: {}, retired: [], lock: null }
    : Schema.decodeUnknownSync(State, { onExcessProperty: 'error' })(value);
};
const store = (value: State) => { setShared(KEY, value); };
const hash = (bytes: string | Uint8Array) => String(createHash('sha256').update(bytes).digest('hex'));
const referenced = (value: State) => new Set(Object.values(value.leases).flatMap(lease => lease.files));
const retire = (value: State, id: string) => { value.retired = [...new Set([...value.retired, ...value.leases[id]?.files ?? []])]; delete value.leases[id]; };
const missing = (cause: unknown) => cause instanceof Error && /(?:ENOENT|not found|No such file)/iu.test(cause.message);
export interface RenderLease { readonly paths: ReadonlyMap<number, string>; release(cx: AsyncContext): Promise<void> }

/** Host shared state coordinates separate JS runtimes. A lock covers filesystem
 * completion, so a final release cannot unlink a newly acquired identical file.
 * Owner heartbeats also reclaim claims abandoned by a reload or app restart. */
export class RenderAssets {
  private owner = '';
  private sequence = 0;
  private heartbeat: Task | undefined;
  private closed = false;
  private sweeping = false;
  private directory = '';

  start(cx: AsyncContext): void {
    this.directory = `${appHome()}/data/concord/render`;
    const value = state(); this.owner = String(++value.next);
    value.owners[this.owner] = Date.now() + LIFETIME; store(value);
    this.heartbeat = cx.timer.every(2000, current => {
      if (this.closed) return;
      const value = state(); value.owners[this.owner] = Date.now() + LIFETIME; store(value);
      if (!this.sweeping && Object.values(value.owners).some(expires => expires <= Date.now())) {
        this.sweeping = true;
        current.spawn(async next => { try { await this.lock(next, () => this.sweep()); } finally { this.sweeping = false; } });
      }
    });
  }

  private async lock<A>(cx: AsyncContext, run: () => Promise<A>): Promise<A> {
    const token = `${this.owner}/${++this.sequence}`;
    for (;;) {
      const value = state();
      if (!value.lock || (value.owners[value.lock.owner] ?? 0) <= Date.now()) {
        value.lock = { owner: this.owner, token }; store(value); break;
      }
      await cx.sleep(10);
    }
    try { return await run(); }
    finally { const value = state(); if (value.lock?.token === token) { value.lock = null; store(value); } }
  }

  private async sweep(): Promise<void> {
    const value = state();
    for (const [owner, expires] of Object.entries(value.owners)) if (expires <= Date.now()) delete value.owners[owner];
    for (const [id, lease] of Object.entries(value.leases)) if (!(lease.owner in value.owners)) retire(value, id);
    store(value);
    const used = referenced(value);
    // Start every deletion before yielding: a native close has a short cleanup deadline.
    await Promise.all(value.retired.filter(file => !used.has(file)).map(async file => {
      try { await unlink(`${this.directory}/${file}`); } catch (cause) { if (!missing(cause)) throw cause; }
    }));
    for (const file of value.retired) {
      const latest = state(); latest.retired = latest.retired.filter(name => name !== file); store(latest);
    }
  }

  async prepare(page: RenderedPage, cx: AsyncContext, current: () => boolean): Promise<RenderLease | undefined> {
    const paths = new Map<number, string>();
    const files = new Map<string, Uint8Array>();
    for (const [index, block] of page.blocks.entries()) {
      if (block.type === 'markdown' || 'error' in block) continue;
      const bytes = block.type === 'image' ? Buffer.from(block.data, 'base64') : Buffer.from(block.type === 'mermaid' ? block.svg : block.html, 'utf8');
      const digest = hash(bytes);
      if (block.type !== 'p5' && block.digest !== `sha256:${digest}`) throw new ModFailure({ message: 'Concord 渲染资源的摘要不一致' });
      const ext = block.type === 'p5' ? 'html' : block.type === 'mermaid' ? 'svg' : ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' } as const)[block.mediaType];
      const name = `${digest}.${ext}`;
      files.set(name, bytes);
      const absolute = `${this.directory}/${name}`.replaceAll('\\', '/');
      const url = `file://${absolute.startsWith('/') ? '' : '/'}${encodeURI(absolute).replaceAll('#', '%23').replaceAll('?', '%3F')}`;
      paths.set(index, block.type === 'p5' ? url : `data/concord/render/${name}`);
    }
    const id = `${this.owner}/${++this.sequence}`;
    return this.lock(cx, async () => {
      if (this.closed || !current()) return;
      await mkdir(this.directory, { recursive: true });
      await this.sweep();
      const value = state(), existing = referenced(value);
      value.leases[id] = { owner: this.owner, files: [...files.keys()] }; store(value);
      try {
        for (const [name, bytes] of files) if (!existing.has(name)) await writeFile(`${this.directory}/${name}`, bytes);
        if (this.closed || !current()) { const value = state(); retire(value, id); store(value); await this.sweep(); return; }
      } catch (cause) { const value = state(); retire(value, id); store(value); await this.sweep(); throw cause; }
      let released = false;
      return { paths, release: async current => {
        if (released) return;
        await this.lock(current, async () => { const value = state(); retire(value, id); store(value); await this.sweep(); released = true; });
      } };
    });
  }

  async close(cx: AsyncContext): Promise<void> {
    this.closed = true;
    if (!this.owner) return;
    try {
      await this.lock(cx, async () => {
        const value = state();
        for (const [id, lease] of Object.entries(value.leases)) if (lease.owner === this.owner) retire(value, id);
        store(value); await this.sweep();
        // Keep the lock owner live until all deletions finish.
        const latest = state(); delete latest.owners[this.owner]; store(latest);
      });
    } finally { this.heartbeat?.cancel(); }
  }
}
