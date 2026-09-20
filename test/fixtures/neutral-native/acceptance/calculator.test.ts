import { appendFileSync, writeFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { add } from '../src/calculator.js';

if (process.env.NEUTRAL_NATIVE_SETUP_SENTINEL !== undefined) {
  writeFileSync(process.env.NEUTRAL_NATIVE_SETUP_SENTINEL, 'setup executed\n');
}

// @fixture-use-case docs/feature/calculator/use-case/add-two-numbers.md
// @fixture-regression memory/calculator.md
test('adds two numbers', () => {
  if (process.env.NEUTRAL_NATIVE_BODY_SENTINEL !== undefined) {
    appendFileSync(process.env.NEUTRAL_NATIVE_BODY_SENTINEL, 'body executed\n');
  }
  expect(add(2, 3)).toBe(5);
});
