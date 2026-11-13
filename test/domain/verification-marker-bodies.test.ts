import assert from 'node:assert/strict';
import test from 'node:test';
import * as annotations from '../../src/domain/tests/index.ts';

// @use-case docs/feature/local-sdlc/use-case/verify-fix-in-one-commit.md#verify-staged
test('verification bodies use the real marker blocks and preserve exact source characters', async () => {
  assert.equal(typeof annotations.testDeclarationBodies, 'function');
  const source = 'const preamble = 1;\r\n// explanatory header\r\n// @name first\r\n// @feature docs/feature/cart/README.md\r\nfirst();\r\n\r\n// @name second\r\n// @feature docs/feature/cart/README.md\r\nsecond(); // exact whitespace  \r\n';
  const parsed = await annotations.testDeclarationBodies('test/cart.ts', source);
  assert.equal(parsed.findings.length, 0);
  assert.equal(parsed.cases.length, 2);
  assert.equal(parsed.bodies.get(parsed.cases[0]!.id), 'first();\r\n\r\n');
  assert.equal(parsed.bodies.get(parsed.cases[1]!.id), 'second(); // exact whitespace  \r\n');
  const prefix = await annotations.testDeclarationBodies('test/cart.ts', source.replace('preamble = 1', 'preamble = 2'));
  assert.deepEqual(prefix.bodies, parsed.bodies);
  const comment = await annotations.testDeclarationBodies('test/cart.ts', source.replace('exact whitespace', 'changed comment'));
  assert.equal(comment.bodies.get(parsed.cases[0]!.id), parsed.bodies.get(parsed.cases[0]!.id));
  assert.notEqual(comment.bodies.get(parsed.cases[1]!.id), parsed.bodies.get(parsed.cases[1]!.id));
});
