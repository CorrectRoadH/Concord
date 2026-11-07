import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { createDocument } from '../support/operations.ts';
import { LocalRepository } from '../support/repository.ts';
import { waitForWorkspaceProjection } from '../support/support.ts';

// @feature docs/feature/web-workbench/ui.md
// @issue docs/issues/default-preview-overrides-click.md
test('a selection made before the category default preview stays selected', async ({ page, workspace }) => {
  const repo = new LocalRepository(workspace.root);
  try {
    createDocument(repo, 'memory', { id: 'first-memory', title: 'First memory', body: 'First memory content.' });
    createDocument(repo, 'memory', { id: 'second-memory', title: 'Second memory', body: 'Second memory content.' });
  } finally { repo.close(); }
  const server = await workspace.ready();
  const base = `http://127.0.0.1:${server.port}`;
  await waitForWorkspaceProjection(base);
  await page.goto(`${base}/memory/first-memory`);
  await expect(page.getByTestId('document-file-preview')).toContainText('First memory content.');
  // Force the click after the category render commits its old preview removal,
  // before its pending default effect runs. Only the DOM scheduling boundary is
  // controlled; routing, link handlers and the document page remain real.
  await page.evaluate(() => {
    const removeChild = Node.prototype.removeChild;
    Node.prototype.removeChild = function<T extends Node>(child: T): T {
      const result = removeChild.call(this, child) as T;
      if (location.pathname !== '/memory') return result;
      const link = [...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="内容导航"] a')].find(link => link.textContent?.trim() === 'Second memory');
      if (!link) return result;
      Node.prototype.removeChild = removeChild;
      document.documentElement.dataset.earlySelection = location.pathname;
      // React suppresses delegated events during a commit. Invoke this link's
      // real registered handler at the boundary rather than falling through to
      // a native full-page load, which would discard the pending default.
      const propsKey = Object.getOwnPropertyNames(link).find(key => key.startsWith('__reactProps$'));
      const props = propsKey === undefined ? undefined : (link as unknown as Record<string, { onClick?: (event: MouseEvent) => void }>)[propsKey];
      if (!props?.onClick) throw new Error('The real navigation link handler was not found');
      props.onClick(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
      return result;
    };
  });
  await page.getByRole('link', { name: 'Memory', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-early-selection', '/memory');
  await expect(page.getByTestId('document-file-preview')).toContainText('Second memory content.');
  assert.equal(new URL(page.url()).pathname, `/memory/${encodeURIComponent('memory/second-memory.md')}`);
  await expect(page.getByRole('navigation', { name: '内容导航', exact: true }).getByRole('link', { name: 'Second memory', exact: true })).toHaveAttribute('aria-current', 'page');
});
