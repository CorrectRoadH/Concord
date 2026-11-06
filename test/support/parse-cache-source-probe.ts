import { Effect } from 'effect';
import { LocalRepository } from "./repository.ts";
import { loadDocuments, inspectDocumentRecords, makeDocumentProjectionCache } from "../../src/domain/documents/index.ts";
import { decodeDocumentSource } from "../../src/domain/documents/index.ts";
import { headingAnchors, inspectSteps } from "../../src/domain/documents/index.ts";
import { makeRuntimeEnvironment as makeParserRuntime } from '../../src/base/environment/index.ts';
const parserRuntime = makeParserRuntime(process.cwd(), process.env);


Effect.runSync(Effect.sync(() => {
  const root = process.argv[2];
  const repo = new LocalRepository(root, { access: 'read', dryRun: process.argv[3] === 'off', runtime: parserRuntime });
  const contentCache = makeDocumentProjectionCache(parserRuntime);
  try {
    const value = repo.snapshot(() => {
      const documents = loadDocuments(repo, undefined, contentCache);
      if (process.argv[3] === 'metadata') return documents;
      const inputs = documents.map(record => ({ path: record.path, source: repo.read(record.path)! }));
      inspectDocumentRecords(inputs.flatMap(input => [input, input]), true, parserRuntime, contentCache);
      return Array.from({ length: 3 }, () => documents.map(record => {
        const source = repo.read(record.path)!;
        const steps = inspectSteps(record.path, source, parserRuntime, contentCache);
        return { record: decodeDocumentSource(record.path, source, parserRuntime, contentCache), steps: steps.steps, anchors: [...headingAnchors(source, record.path, parserRuntime, contentCache)], items: steps.items.map(item => ({ line: item.item.position?.start.line, listOrdinal: item.listOrdinal })) };
      }));
    });
    console.log(JSON.stringify(value));
  } finally { try { contentCache.close(); } finally { repo.close(); } }
}));
