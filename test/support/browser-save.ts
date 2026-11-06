import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { parseWorkspaceProjection } from './support.ts';
import { digest } from '../../src/model/index.ts';

/** Register before the edit: disk publication precedes the browser receipt. */
export function browserActionReceipt(page: Page, action: string, matches: (input: Record<string, unknown>) => boolean = () => true): Promise<void> {
  return page.waitForResponse(response => {
    if (response.request().method() !== 'POST' || new URL(response.url()).pathname !== '/api/action') return false;
    const input = response.request().postDataJSON() as Record<string, unknown>;
    return input.action === action && matches(input);
  }).then(async response => {
    assert.equal(response.status(), 200, `${action}: ${await response.text()}`);
    assert.equal(await response.finished(), null);
  });
}

/** A save receipt does not yet include the subsequent workspace refresh. */
export function browserDocumentProjection(page: Page, path: string, body: string): Promise<void> {
  return page.waitForResponse(async response => {
    if (response.request().method() !== 'GET' || new URL(response.url()).pathname !== '/api/workspace' || response.status() !== 200) return false;
    const projection = parseWorkspaceProjection(await response.text());
    return projection?.snapshot.documents.some(document => document.path === path && document.digest === digest(body)) ?? false;
  }).then(async response => { assert.equal(await response.finished(), null); });
}
