import { Effect } from 'effect';
import { LocalRepository } from "../src/base/workspace/index.js";
import { loadDocuments, inspectDocumentRecords } from "../src/domain/documents/index.js";
import { decodeDocumentSource } from "../src/domain/documents/index.js";
import { headingAnchors, inspectSteps } from "../src/domain/documents/index.js";

Effect.runSync(Effect.sync(() => {
  const root = process.argv[2];
  const repo = new LocalRepository(root, { access: 'read', dryRun: process.argv[3] === 'off' });
  try {
    const value = repo.snapshot(() => {
      const documents = loadDocuments(repo);
      if (process.argv[3] === 'metadata') return documents;
      const inputs = documents.map(record => ({ path: record.path, source: repo.read(record.path)! }));
      inspectDocumentRecords(inputs.flatMap(input => [input, input]), true);
      return Array.from({ length: 3 }, () => documents.map(record => {
        const source = repo.read(record.path)!;
        const steps = inspectSteps(record.path, source);
        return { record: decodeDocumentSource(record.path, source), steps: steps.steps, anchors: [...headingAnchors(source, record.path)], items: steps.items.map(item => ({ line: item.item.position?.start.line, listOrdinal: item.listOrdinal })) };
      }));
    });
    console.log(JSON.stringify(value));
  } finally { repo.close(); }
}));
