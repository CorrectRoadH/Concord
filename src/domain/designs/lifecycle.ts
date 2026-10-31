import { readDesignPlanPaths } from "../../base/sources/index.js";
import { posix } from "node:path";
import { writeDesignDeclaration } from "../../model/index.js";
import { ConcordError, DocumentName, decode, inRepositorySnapshot, type MutationReceipt, type Repository } from "../../model/index.js";
import { resolveReference } from "../documents/index.js";
import { designContentPaths, formatDesignMarkdown } from "../../model/index.js";
import { validateDesignContent } from "../documents/index.js";
import { CONTRACT_KINDS } from "../documents/index.js";
import { required } from "../documents/index.js";
import { loadDocuments } from "../documents/index.js";
import { readDocumentSelector } from "../documents/index.js";
import { findDocument } from "../documents/index.js";
import { designSnapshot } from "../documents/index.js";


/** Updates only explicit author-owned metadata; lifecycle and identity remain domain operations. */
// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/compare-design-plans.md
export function decideDesign(repo: Repository, selector: string, selected: string, targets: readonly string[], reason: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
  const documents = loadDocuments(repo); const record = findDocument(documents, selector, 'design');
  if (record.metadata.kind !== 'design') throw new ConcordError('InvalidDocumentKind', selector);
  if (record.metadata.decision !== undefined) throw new ConcordError('DecisionExists', 'A Design decision cannot be overwritten');
  const choice = decode(DocumentName, selected, 'selected');
  if (!record.metadata.alternatives.includes(choice)) throw new ConcordError('InvalidDecision', `${choice} is not a declared alternative`);
  const uniqueTargets = [...new Set(targets)];
  if (uniqueTargets.length !== targets.length) throw new ConcordError('InvalidDecision', 'Decision targets must be unique');
  for (const target of targets) resolveReference(repo, documents, target, CONTRACT_KINDS);
  const snapshot = designSnapshot(repo, record);
  const decisionPath = `${posix.dirname(record.path)}/DECISION.md`;
  const entries = readDesignPlanPaths(repo.root, posix.dirname(record.path), record.metadata.alternatives);
  const decisionSource = snapshot.get(decisionPath);
  if (decisionSource === undefined) throw new ConcordError('DesignDecisionIncomplete', `${decisionPath} is missing`);
  const next = writeDesignDeclaration(decisionSource, `Selected: [${choice}](${posix.relative(posix.dirname(record.path), entries.get(choice)!)})`, required(reason, 'reason'));
  const candidate = new Map(snapshot).set(decisionPath, next);
  const assessment = validateDesignContent(posix.dirname(record.path), record.metadata.alternatives, candidate, choice);
  if (assessment.findings.length) throw new ConcordError('DesignDecisionIncomplete', assessment.findings.map(item => `${item.code}: ${item.path}: ${item.message}`).join('\n'));
  return repo.publish('decide-design', [...snapshot].flatMap(([path, source]) => source === undefined ? [] : [{ path, before: source, after: path === decisionPath ? next : source }]), dryRun);
  });
}
export function deferDesign(repo: Repository, selector: string, reason: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
    const record = readDocumentSelector(repo, selector, 'design');
    if (record.metadata.kind !== 'design') throw new ConcordError('InvalidDocumentKind', selector);
    if (record.metadata.decision !== undefined) throw new ConcordError('DecisionExists', 'A Design decision cannot be overwritten');
    const path = `${posix.dirname(record.path)}/DECISION.md`;
    const before = repo.read(path);
    if (before === undefined) throw new ConcordError('DesignDecisionIncomplete', `${path} is missing`);
    return repo.publish('defer-design', [{ path, before, after: writeDesignDeclaration(before, `Deferred: ${required(reason, 'reason')}`) }], dryRun);
  });
}
export function checkDesign(repo: Repository, selector: string) {
  return inRepositorySnapshot(repo, () => {
  const record = findDocument(loadDocuments(repo), selector, 'design');
  if (record.metadata.kind !== 'design') throw new ConcordError('InvalidDocumentKind', record.path);
  const snapshot = designSnapshot(repo, record);
  const result = validateDesignContent(posix.dirname(record.path), record.metadata.alternatives, snapshot, record.metadata.decision?.selected);
  for (const [path, source] of snapshot) if (repo.read(path) !== source) throw new ConcordError('FileChangedSinceRead', `${path} changed while checking Design`);
  return { operation: 'design-check', path: record.path, ok: result.findings.length === 0, ...result };
  });
}
export function formatDesign(repo: Repository, selector: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
  const record = findDocument(loadDocuments(repo), selector, 'design');
  const snapshot = designSnapshot(repo, record);
  const changes = [...snapshot].flatMap(([path, source]) => {
    if (source === undefined || record.metadata.kind !== 'design' || !designContentPaths(posix.dirname(record.path), record.metadata.alternatives).includes(path)) return [];
    const next = path === record.path ? source : formatDesignMarkdown(source);
    return next === source ? [] : [{ path, before: source, after: next }];
  });
  if (changes.length === 0) return { operation: 'format-design', dryRun, changedPaths: [] };
  changes.unshift({ path: record.path, before: snapshot.get(record.path)!, after: snapshot.get(record.path)! });
  return repo.publish('format-design', changes, dryRun);
  });
}
