import { test as base, surfaceOf, type Browser } from '@e2e-dev/web';
import { Effect } from 'effect';
import type { TestAPI, TestFixtures } from 'e2e';
import { engine } from './engine.js';

type Page = ReturnType<NonNullable<ReturnType<typeof surfaceOf>>['page']>;

/** Keep precision probes on the engine's page so its trace sees the same context. */
export const test: TestAPI<TestFixtures & { browser: Browser; page: Page }> = base.extend<{ page: Page }>({
  page: ({ browser }, use) => Effect.runPromise(Effect.tryPromise(async () => {
    await browser.goto('about:blank');
    const surface = surfaceOf(engine);
    if (!surface) throw new Error('Concord E2E requires the configured Web engine');
    const page = surface.page();
    page.setDefaultTimeout(15_000);
    await use(page);
  })),
});
