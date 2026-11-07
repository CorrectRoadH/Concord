import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Effect } from 'effect';
import { createConsumer, withConsumer } from '../support/consumer.ts';
import { createDocument } from '../support/operations.ts';
import { withRepository } from '../support/application-fixture.ts';
import { closeIssue, linkIssue } from '../../src/domain/issues/index.ts';
import { ConcordError } from '../../src/model/index.ts';

// @use-case docs/engineering/testing/use-case/write-regression-test.md#write
test('close refuses while another Issue links the target', () => Effect.runPromise(Effect.tryPromise(async () => (await withConsumer(async repo => {
  for (const id of ['one', 'two']) (await createDocument(repo, 'issue', { id, title: id }));
  (await linkIssue(repo, 'two', 'docs/issues/one.md', false, 'related'));
  (await assert.rejects(async () => (await closeIssue(repo, 'one', 'Done')), (cause: unknown) => cause instanceof ConcordError && cause.code === 'IssueReferenced'));
})))));

/** A consumer where Issue `two` links `one`; closing the scope deletes it. */
const linkedIssues = Effect.acquireRelease(
  Effect.tryPromise(async () => {
    const root = (await createConsumer());
    (await withRepository(root, async repo => {
      for (const id of ['one', 'two']) (await createDocument(repo, 'issue', { id, title: id }));
      (await linkIssue(repo, 'two', 'docs/issues/one.md', false, 'related'));
    }));
    return root;
  }),
  root => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
);

// @use-case docs/engineering/testing/use-case/extend-fixtures.md#create
test('linked Issue fixture closes repositories and removes its scoped consumer', () => Effect.runPromise(Effect.gen(function*() {
  const root = yield* Effect.scoped(Effect.gen(function*() {
    const root = yield* linkedIssues;
    (yield* Effect.tryPromise(async () => (await withRepository(root, async repo => (await assert.rejects(async () => (await closeIssue(repo, 'one', 'Done')), (cause: unknown) => cause instanceof ConcordError && cause.code === 'IssueReferenced'))))));
    assert.equal(existsSync(join(root, 'docs/issues/one.md')), true);
    return root;
  }));
  assert.equal(existsSync(root), false);
})));
