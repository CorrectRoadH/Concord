import { designState } from "../../model/index.js";
import { posix } from "node:path";
import { readDesignPlanPaths } from "../../base/sources/index.js";
import { type DocumentRecord, type Repository } from "../../model/index.js";


/** Keep the parser cache byte-local; filesystem-derived state belongs to this snapshot. */
export function deriveDesignRecord(repo: Pick<Repository, 'root' | 'read' | 'files'>, record: DocumentRecord): DocumentRecord {
  if (record.metadata.kind !== 'design') return record;
  const base = posix.dirname(record.path);
  repo.files(`${base}/plans`);
  const entries = readDesignPlanPaths(repo.root, base);
  for (const entry of entries.values()) repo.read(entry);
  const state = designState(repo.read(`${base}/DECISION.md`) ?? '', base, entries);
  return { ...record, metadata: { ...record.metadata, alternatives: [...entries.keys()],
    ...(state.selected === undefined ? {} : { decision: { selected: state.selected, reason: state.rationale || 'Selected in DECISION', targets: [] } }),
    ...(state.deferred === undefined ? {} : { deferral: { reason: state.deferred } }),
  } };
}
