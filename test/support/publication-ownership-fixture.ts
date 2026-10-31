import { rmSync } from 'node:fs';
import type { TestContext } from 'node:test';
import { createConsumer } from './consumer.js';
import { writeProjectConfig } from './support.js';

export function fixture(t: TestContext): string {
  const root = createConsumer();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeProjectConfig(root, { testRoots: [] });
  return root;
}
