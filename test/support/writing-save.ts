import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { Effect } from 'effect';

/** Wait for the saved policy before a browser reload. */
export const waitForWritingSave = (_page: Page, path: string, replacement: string): Promise<void> =>
  Effect.runPromise(Effect.tryPromise(async () => {
    await expect.poll(() => (JSON.parse(readFileSync(path, 'utf8')) as { bannedTerms: { use?: string }[] }).bannedTerms.at(-1)?.use).toBe(replacement);
  }));
