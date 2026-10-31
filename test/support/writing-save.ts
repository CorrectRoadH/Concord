import { parseWritingPolicy } from '../../src/model/index.js';
import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { Effect } from 'effect';

/** Wait for the saved policy before a browser reload. */
export const waitForWritingSave = (page: Page, path: string, replacement: string): Promise<void> =>
  Effect.runPromise(Effect.tryPromise(async () => {
    await expect(page.getByRole('region', { name: '写作规则编辑' }).getByRole('status')).toHaveText('写作规则已保存。');
    await expect(page.getByText('有未保存更改', { exact: true })).toHaveCount(0);
    await expect.poll(() => parseWritingPolicy(readFileSync(path, 'utf8')).bannedTerms.at(-1)?.use).toBe(replacement);
  }));
