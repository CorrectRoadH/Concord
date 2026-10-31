// @concord-file
// @concord-implements docs/feature/herdr-panel/architecture.md#渲染
import type { WorkspaceDocument, WorkspacePage, WorkspaceProjectionSnapshot, WorkspaceProjectionStatus } from '../index.js';
import { DOCUMENT_ROOTS, selectEffectiveConcepts, scopeOf, fromMarkdown, markdownBody } from '../index.js';

export const documentCategories = [
  { href: '/features', kind: 'feature', label: 'Feature' },
  { href: '/engineering', kind: 'engineering', label: 'Engineering' },
  { href: '/roadmap', kind: 'roadmap', label: 'Roadmap' },
  { href: '/design', kind: 'design', label: 'Design' },
  { href: '/memory', kind: 'memory', label: 'Memory' },
] as const;
export function documentsInCategory(snapshot: WorkspaceProjectionSnapshot, kind: string): readonly WorkspaceDocument[] {
  return snapshot.documents.filter(document => document.metadata.kind === kind);
}
export function featureMatches(reference: string, feature: Pick<WorkspaceDocument, 'path' | 'metadata'>): boolean {
  return reference === feature.path || reference === feature.metadata.id;
}
export function featureUseCases(snapshot: WorkspaceProjectionSnapshot, feature: WorkspaceDocument): readonly WorkspaceDocument[] {
  return snapshot.documents.filter(document => document.metadata.kind === 'use-case' && featureMatches(document.metadata.feature, feature));
}
export function featureTree(snapshot: WorkspaceProjectionSnapshot) {
  return documentsInCategory(snapshot, 'feature').map(feature => ({ feature, useCases: featureUseCases(snapshot, feature) }));
}
/** Preserve Web's exact relation matching (including support pages). */
export function contractIdentities(snapshot: WorkspaceProjectionSnapshot, document: WorkspaceDocument): Set<string> {
  const owners = new Set([document.path]);
  if (document.metadata.kind === 'feature') {
    for (const child of snapshot.documents) if (child.metadata.kind === 'use-case' && child.metadata.feature === document.path) owners.add(child.path);
  }
  return new Set([...owners, ...snapshot.pages.filter(page => page.documentPath && owners.has(page.documentPath)).map(page => page.path)]);
}
export function implementationGroups(snapshot: WorkspaceProjectionSnapshot, document: WorkspaceDocument) {
  const owners = [document, ...(document.metadata.kind === 'feature' ? snapshot.documents.filter(item => item.metadata.kind === 'use-case' && item.metadata.feature.split('#')[0] === document.path) : [])];
  return owners.map(owner => {
    const references = new Set([owner.path, ...snapshot.pages.filter(page => page.documentPath === owner.path).map(page => page.path)]);
    return { owner, codes: snapshot.codes.filter(code => code.contracts.some(ref => references.has(ref.split('#')[0]!))), references };
  });
}
export function relatedTests(snapshot: WorkspaceProjectionSnapshot, document: WorkspaceDocument) {
  const identities = contractIdentities(snapshot, document);
  return snapshot.cases.filter(item => identities.has(item.contract.split('#')[0]!));
}
export function testGroups(snapshot: WorkspaceProjectionSnapshot, document: WorkspaceDocument) {
  return implementationGroups(snapshot, document).map(({ owner, references }) => ({ owner, cases: snapshot.cases.filter(item => references.has(item.contract.split('#')[0]!)) }));
}
export function testDeclarationSummary(snapshot: WorkspaceProjectionSnapshot, document: WorkspaceDocument) {
  const cases = relatedTests(snapshot, document);
  const useCases = document.metadata.kind === 'feature' ? featureUseCases(snapshot, document) : [];
  return { count: new Set([...cases, ...useCases.flatMap(child => relatedTests(snapshot, child))].map(item => item.id)).size, untestedUseCases: useCases.filter(child => relatedTests(snapshot, child).length === 0) };
}
export function effectiveWorkspaceConcepts(snapshot: Pick<WorkspaceProjectionSnapshot, 'conceptCatalogs' | 'pages'>, path: string) {
  return selectEffectiveConcepts(path, snapshot.conceptCatalogs.map(catalog => ({ path: catalog.path, scope: scopeOf(catalog.path, 'catalog'), catalog })))
    .map(item => ({ ...item.concept, path: item.path, digest: snapshot.pages.find(page => page.path === item.path)?.digest ?? '', reference: item.reference }));
}
export function projectionIsConclusive(projection: WorkspaceProjectionStatus): boolean {
  return projection.status === 'ready' && projection.consistent && projection.complete && !projection.unknownRelations;
}
const ROOT_RANK = ['docs/README.md', 'docs/architecture.md', 'docs/taste.md', 'docs/concepts.md', 'docs/concord.md'];
function under(path: string, root: string): boolean { return path === root || path.startsWith(`${root}/`); }
function projectDocSort(path: string): string {
  const rank = ROOT_RANK.indexOf(path);
  if (rank >= 0) return `0${rank}`;
  if (path.startsWith('docs/_template/')) return `2${path}`;
  return `1${path}`;
}
export function projectDocPages(snapshot: WorkspaceProjectionSnapshot): readonly WorkspacePage[] {
  const memoryRoots = ['memory'], roots = [...DOCUMENT_ROOTS, ...memoryRoots];
  return snapshot.pages
    .filter(page => page.path.endsWith('.md') && (page.path.startsWith('docs/') && !roots.some(root => under(page.path, root)) || page.documentPath === undefined && memoryRoots.some(root => under(page.path, root))))
    .sort((left, right) => projectDocSort(left.path).localeCompare(projectDocSort(right.path)));
}
export function projectDocTitle(page: Pick<WorkspacePage, 'path' | 'derivedTitle'>): string {
  if (page.path.startsWith('docs/_template/')) return page.path.slice('docs/'.length);
  return page.derivedTitle ?? (page.path.startsWith('docs/') ? page.path.slice('docs/'.length) : page.path);
}
export function workspaceDisplay(snapshot: WorkspaceProjectionSnapshot) {
  return {
    categories: documentCategories.map(category => ({ ...category, documents: documentsInCategory(snapshot, category.kind) })),
    features: featureTree(snapshot), pages: projectDocPages(snapshot), supportPages: snapshot.pages.filter(page => page.documentPath !== undefined),
    conceptCatalogs: snapshot.conceptCatalogs,
    sources: snapshot.sources, findings: snapshot.findings,
    documents: snapshot.documents.map(document => ({ document, implementations: implementationGroups(snapshot, document), tests: relatedTests(snapshot, document), testGroups: testGroups(snapshot, document), testSummary: testDeclarationSummary(snapshot, document), concepts: effectiveWorkspaceConcepts(snapshot, document.path) })),
  };
}
export type WorkspaceDisplay = ReturnType<typeof workspaceDisplay>;

export function workspaceDocumentHref(document: Pick<WorkspaceDocument, 'path' | 'metadata'>, documents: readonly WorkspaceDocument[]): string {
  if (document.metadata.kind === 'use-case') {
    const feature = document.metadata.feature;
    const owner = documents.filter(candidate => candidate.metadata.kind === 'feature' && featureMatches(feature, candidate));
    if (owner.length !== 1) return '/features';
    return `/features/${encodeURIComponent(owner[0]!.metadata.id)}/use-cases/${encodeURIComponent(document.metadata.id)}`;
  }
  const sections = { feature: 'features', engineering: 'engineering', roadmap: 'roadmap', design: 'design', memory: 'memory', issue: 'feedback' };
  return `/${sections[document.metadata.kind]}/${encodeURIComponent(document.metadata.kind === 'memory' ? document.path : document.metadata.id)}`;
}
export function workspacePathHref(snapshot: WorkspaceProjectionSnapshot, reference: string): string {
  const [path, anchor] = reference.split('#');
  const page = snapshot.pages.find(page => page.path === path);
  const owner = snapshot.documents.find(document => document.path === (page?.documentPath ?? path));
  const href = owner ? `${workspaceDocumentHref(owner, snapshot.documents)}${owner.path === path ? '' : `?file=${encodeURIComponent(path!)}`}` : `/docs?file=${encodeURIComponent(path!)}`;
  return `${href}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`;
}

/** Read the selected H2 section, including its definition and explanation. */
export function conceptBody(source: string, id: string): string | undefined {
  const nodes = fromMarkdown(markdownBody(source)).children;
  const index = nodes.findIndex(node => node.type === 'heading' && node.depth === 2 && node.children.every(child => child.type === 'text') && node.children.map(child => child.type === 'text' ? child.value : '').join('').endsWith(`{#${id}}`));
  if (index < 0) return;
  const start = nodes[index]!.position!.end.offset!;
  const next = nodes.slice(index + 1).find(node => node.type === 'heading' && node.depth <= 2);
  return source.slice(start, next?.position?.start.offset ?? source.length).trim();
}

export function displayConcepts(model: WorkspaceDisplay, path: string) {
  return effectiveWorkspaceConcepts({ conceptCatalogs: model.conceptCatalogs, pages: [...model.pages, ...model.supportPages] }, path);
}
