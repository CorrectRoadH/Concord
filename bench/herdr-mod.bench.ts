import { Effect, type Scope } from 'effect';
import { bench } from 'mitata';
import { pageSource } from '../src/model/herdr-mod/index.ts';
import { ModSession } from '../src/entry/herdr-mod/index.ts';
import { documentBodies, featurePath, modRepositoryFixture, ModBenchmarkFailure } from './support/herdr-mod.ts';
import { runBenchmarks } from './run.ts';

export function registerBenchmarks(scope: Scope.Scope): void {
  // Fixed ~4 KiB Markdown: paragraphs, definitions, images, Mermaid and p5 blocks. No host/CLI timing.
  const source = '# Read a page\n\n' + 'A Snapshot keeps current facts and a readable [reference][page].\n\n'.repeat(57)
    + '![preview](image.png)\n\n[page]: page.md\n\n```mermaid\nflowchart LR\n A --> B\n```\n\n```p5\nfunction setup() { createCanvas(100, 100); }\n```\n';
  bench('herdr-mod/page-source', () => {
    const result = pageSource(source);
    if (result.special.length !== 3) throw new Error('Page source lost its image or live blocks');
    return result;
  });
  // Two private initialized repositories, one ~4 KiB Feature each; warm services.
  // CLI startup and IPC are timed. Fixture setup/cleanup and native drawing are not.
  bench('herdr-mod/first-refresh', async function*() {
    const fixture = await modRepositoryFixture(scope);
    try {
      yield async () => {
        const session = new ModSession(fixture.host, fixture.roots[0]);
        try {
          await Effect.runPromise(session.refresh());
          if (!session.loaded || !session.initialized || !session.documents.some(item => item.path === featurePath)) {
            throw new ModBenchmarkFailure({ message: 'First refresh did not expose the Feature list' });
          }
          return session.documents;
        } finally { session.stop(); }
      };
    } finally { await fixture.close(); }
  });
  bench('herdr-mod/switch-repository', async function*() {
    const fixture = await modRepositoryFixture(scope);
    let previous = new ModSession(fixture.host, fixture.roots[0]);
    let index = 0;
    try {
      await Effect.runPromise(previous.refresh());
      yield async () => {
        previous.suspend();
        previous.stop();
        index = 1 - index;
        const root = fixture.roots[index]!;
        // A newly selected repository gets a fresh session, never an already resolved Promise.
        previous = new ModSession(fixture.host, root);
        await Effect.runPromise(previous.refresh());
        if (previous.root !== root || !previous.loaded || !previous.documents.some(item => item.path === featurePath)) {
          throw new ModBenchmarkFailure({ message: 'Repository switch did not expose the destination Feature list' });
        }
        return previous.documents;
      };
    } finally { previous.stop(); await fixture.close(); }
  });
  bench('herdr-mod/save-confirmation', async function*() {
    const fixture = await modRepositoryFixture(scope);
    const session = new ModSession(fixture.host, fixture.roots[0]);
    try {
      await Effect.runPromise(session.refresh());
      await Effect.runPromise(session.open(featurePath));
      let index = 0;
      yield async () => {
        index = 1 - index;
        const body = documentBodies[index]!;
        await Effect.runPromise(session.save(body));
        // The product readback, not a second benchmark filesystem read, confirms the write.
        if (session.saving || session.draft !== undefined || session.source !== body || session.deleted) {
          throw new ModBenchmarkFailure({ message: 'Save returned before its readback confirmation' });
        }
        return session.sourceDigest;
      };
    } finally { session.stop(); await fixture.close(); }
  });
}
if (import.meta.main) runBenchmarks(registerBenchmarks);
