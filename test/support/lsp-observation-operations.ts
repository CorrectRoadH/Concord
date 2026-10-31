import assert from 'node:assert/strict';
import { Schema } from 'effect';
import { analyzeCode, executeQuery, type QueryRequest } from '../../src/app/index.js';
import { AnalysisObservationSchema, AnalysisViewSchema, CodeDeclarationSchema } from '../../src/model/index.js';
import { LocalRepository, runApplication } from './repository.js';

export const analysis = Schema.Struct({ observations: Schema.Array(AnalysisObservationSchema) });
export const codeList = Schema.Struct({ codes: Schema.Array(CodeDeclarationSchema), analysis: AnalysisViewSchema });
export const projectCheck = Schema.Struct({ ok: Schema.Boolean, findings: Schema.Array(Schema.Unknown), complete: Schema.optional(Schema.Boolean) });
export async function query<A>(root: string, request: QueryRequest, schema: Schema.ConstraintDecoder<A, never>, exitCode = 0, language?: string): Promise<A> {
  const prior = process.env.LANG;
  if (language !== undefined) process.env.LANG = language;
  try {
    const reply = await runApplication(executeQuery(root, request));
    assert.equal(reply.exitCode, exitCode);
    return Schema.decodeUnknownSync(schema, { onExcessProperty: 'ignore' })(reply.value);
  } finally { if (prior === undefined) delete process.env.LANG; else process.env.LANG = prior; }
}
export async function analyze(root: string) {
  const repo = new LocalRepository(root, { optimistic: true });
  try { return Schema.decodeUnknownSync(analysis, { onExcessProperty: 'ignore' })(await runApplication(analyzeCode(repo))); }
  finally { repo.close(); }
}

