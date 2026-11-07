import { rmSync } from 'node:fs';
import type { TestContext } from 'node:test';
import { createConsumer } from './consumer.ts';
import { writeProjectConfig } from './support.ts';

export async function fixture(t: TestContext): Promise<string> {
  const root = (await createConsumer());
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeProjectConfig(root, { testRoots: [] });
  return root;
}
