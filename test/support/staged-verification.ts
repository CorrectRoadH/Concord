import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readProjectConfig, writeProjectConfig } from './support.ts';
import { createFixConsumer, gitCommand, gitCommit } from './fix-consumer.ts';

export async function stagedVerificationFixture(timeoutMs?: number) {
  const fixture = await createFixConsumer();
  const path = join(fixture.root, 'test/cart.test.ts');
  const source = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { quantity } from '../src/cart.ts';\n// @feature docs/feature/cart/README.md\n// @name quantity accumulates\ntest('quantity accumulates', () => assert.equal(quantity, 1));\n// @feature docs/feature/cart/README.md\n// @name unchanged sanity\ntest('unchanged sanity', () => assert.ok(quantity > 0));\n";
  writeFileSync(path, source);
  if (timeoutMs !== undefined) {
    const config = await readProjectConfig(fixture.root);
    writeProjectConfig(fixture.root, { ...config, runner: { ...config.runner!, timeoutMs } });
  }
  const base = gitCommit(fixture.root, 'baseline cases');
  writeFileSync(path, source.replace('equal(quantity, 1)', 'equal(quantity, 2)'));
  writeFileSync(join(fixture.root, 'src/cart.ts'), 'export const quantity = 2;\n');
  gitCommand(fixture.root, 'add', '.');
  const stage = () => gitCommand(fixture.root, 'add', '.');
  const editTest = (edit: (source: string) => string) => { writeFileSync(path, edit(readFileSync(path, 'utf8'))); stage(); };
  return { ...fixture, source, base, stage, editTest };
}
