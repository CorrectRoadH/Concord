import { posix } from "node:path";
import { fromMarkdown } from "../model/index.js";
import { renderDocument } from "../model/index.js";
import { ConcordError, DocumentName, decode, digest, inRepositorySnapshot, type DocumentMeta, type MutationReceipt, type Repository } from "../model/index.js";
import { rebaseAdoptedMarkdown } from "../domain/documents/index.js";
import { defaultDocumentPath } from "../model/index.js";
import { loadDocuments } from "../domain/documents/index.js";
import { findDocument } from "../domain/documents/index.js";


// @concord-code
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#adopt
export function adoptRoadmap(repo: Repository, selector: string, featureId: string, dryRun = false): MutationReceipt {
  return inRepositorySnapshot(repo, () => {
  const documents = loadDocuments(repo); const roadmap = findDocument(documents, selector, 'roadmap');
  if (roadmap.metadata.kind !== 'roadmap') throw new ConcordError('InvalidDocumentKind', selector);
  if (roadmap.metadata.state !== 'planned') throw new ConcordError('InvalidRoadmapState', 'Only a planned Roadmap can be adopted');
  const id = decode(DocumentName, featureId, 'featureId'); const featurePath = defaultDocumentPath('feature', id);
  if (documents.some(document => document.metadata.kind === 'feature' && document.metadata.id === id)) throw new ConcordError('DocumentExists', `Feature id ${id} already exists`);
  if (repo.read(featurePath) !== undefined) throw new ConcordError('DocumentExists', `${featurePath} already exists`);
  const roadmapDirectory = posix.dirname(roadmap.path);
  const featureDirectory = posix.dirname(featurePath);
  if (repo.files(featureDirectory).length > 0 || (repo.exists?.(featureDirectory) ?? false)) throw new ConcordError('DocumentExists', `${featureDirectory} already exists`);
  const sourcePaths = repo.files(roadmapDirectory).sort();
  const observed = new Map<string, string>();
  const changes: import("../model/index.js").Change[] = [];
  for (const sourcePath of sourcePaths) {
    if (!sourcePath.endsWith('.md')) throw new ConcordError('UnsupportedAttachment', `Roadmap adoption only moves Markdown pages: ${sourcePath}`);
    const source = repo.read(sourcePath);
    if (source === undefined) throw new ConcordError('FileChangedSinceRead', `${sourcePath} disappeared during adoption`);
    observed.set(sourcePath, source);
    if (sourcePath !== roadmap.path && (/^(?:\uFEFF)?---(?:\r?\n|$)/u.test(source) || documents.some(document => document.path === sourcePath))) throw new ConcordError('NestedOwner', `Roadmap adoption refuses nested owners: ${sourcePath}`);
    const destination = `${featureDirectory}/${sourcePath.slice(roadmapDirectory.length + 1)}`;
    if (repo.read(destination) !== undefined) throw new ConcordError('DocumentExists', destination);
    changes.push({ path: sourcePath, before: source, after: null }, { path: destination, before: null, after: rebaseAdoptedMarkdown(source, sourcePath, destination, roadmapDirectory) });
  }
  if (observed.get(roadmap.path) === undefined || digest(observed.get(roadmap.path)!) !== roadmap.digest) throw new ConcordError('FileChangedSinceRead', 'Roadmap owner changed during adoption planning');
  const mapReference = (target: string): string => target === roadmapDirectory || target.startsWith(`${roadmapDirectory}/`) ? `${featureDirectory}${target.slice(roadmapDirectory.length)}` : target;
  const byPath = new Map(documents.map(record => [record.path, record]));
  const markdown = new Set([...repo.files('docs'), ...repo.files('memory')].filter(path => path.endsWith('.md') && !observed.has(path)));
  for (const path of markdown) {
    const before = repo.read(path);
    if (before === undefined) continue;
    const record = byPath.get(path);
    let source = before;
    if (record?.metadata.kind === 'memory' || record?.metadata.kind === 'issue') {
      const relations = record.metadata.relations.map(relation => ({ ...relation, target: mapReference(relation.target) }));
      if (JSON.stringify(relations) !== JSON.stringify(record.metadata.relations)) source = renderDocument({ ...record.metadata, relations } as DocumentMeta, record.body);
      if (record.metadata.kind === 'issue' && record.metadata.closure?.kind === 'delivered') {
        const closure = { ...record.metadata.closure, target: mapReference(record.metadata.closure.target) };
        if (closure.target !== record.metadata.closure.target) source = renderDocument({ ...record.metadata, relations: relations as import("../model/index.js").IssueMeta['relations'], closure }, record.body);
      }
    }
    // Only documents with an inbound Markdown link need the bounded link transform.
    const links: { url: string }[] = [];
    const visit = (node: import('mdast').Nodes): void => {
      if (node.type === 'link' || node.type === 'image' || node.type === 'definition') links.push({ url: node.url });
      if ('children' in node) node.children.forEach(visit);
    };
    visit(fromMarkdown(source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u, '')));
    const inbound = links.some(link => !/^(?:[A-Za-z][A-Za-z0-9+.-]*:|[/#])/u.test(link.url) && mapReference(posix.normalize(posix.join(posix.dirname(path), link.url.split('#')[0]!))) !== posix.normalize(posix.join(posix.dirname(path), link.url.split('#')[0]!)));
    if (inbound) source = rebaseAdoptedMarkdown(source, path, path, roadmapDirectory, featureDirectory);
    if (source !== before) changes.push({ path, before, after: source });
  }
  // Recheck after the entire plan, including link transforms and promotions.
  const recaptured = repo.files(roadmapDirectory).sort();
  if (recaptured.length !== sourcePaths.length || recaptured.some((path, index) => path !== sourcePaths[index])) throw new ConcordError('FileChangedSinceRead', 'Roadmap source collection changed during adoption planning');
  for (const sourcePath of sourcePaths) if (repo.read(sourcePath) !== observed.get(sourcePath)) throw new ConcordError('FileChangedSinceRead', `${sourcePath} changed during adoption planning`);
  return repo.publish('adopt-roadmap', changes, dryRun);
  });
}
