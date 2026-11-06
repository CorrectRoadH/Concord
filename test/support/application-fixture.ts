import assert from 'node:assert/strict';
import { Schema } from 'effect';
import { executeQuery, executeViewAction, type QueryRequest } from '../../src/app/index.js';
import { LocalRepository, runApplication } from './repository.js';

/** Use the transport's real application reply, including its exit decision and JSON value. */
export async function query<A>(root: string, request: QueryRequest, schema: Schema.ConstraintDecoder<A, never>, exitCode = 0): Promise<A> {
  const reply = await runApplication(executeQuery(root, request, 'off'));
  assert.equal(reply.exitCode, exitCode, JSON.stringify({ request, reply }));
  return Schema.decodeUnknownSync(schema, { onExcessProperty: 'ignore' })(reply.value);
}

export async function action<A>(root: string, input: unknown, schema: Schema.ConstraintDecoder<A, never>): Promise<A> {
  return Schema.decodeUnknownSync(schema, { onExcessProperty: 'ignore' })(await runApplication(executeViewAction(root, input)));
}

export function withRepository<A>(root: string, operation: (repo: LocalRepository) => A): A {
  const repo = new LocalRepository(root);
  try { return operation(repo); } finally { repo.close(); }
}
