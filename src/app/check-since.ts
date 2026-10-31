// @concord-file
// @concord-implements docs/feature/local-sdlc/cli.md#检查本次变化
// @concord-implements docs/feature/local-sdlc/architecture.md#差异门禁
import { posix } from "node:path";
import { Effect } from "effect";
import { fromMarkdown } from "../model/index.js";
import { decodeUncachedDocumentSource, ownerKind } from "../model/index.js";
import { rebaseAdoptedMarkdown } from "../domain/documents/index.js";
import { designState } from "../model/index.js";
import { validateDesignContent } from "../domain/documents/index.js";
import { parseConstitution, trailingId, markdownLinks, relativeMarkdownLink } from "../domain/constitution/index.js";
import { replayFix } from "../domain/tests/index.js";
import { checkCurrentProject } from "./check-current.js";
import { type LocalRepository, openReadRepository, git } from "../base/workspace/index.js";
import { commitRepository, resolveCommit, worktreeIdentity } from "../base/git/index.js";
import { ConcordError, canonical, failure, type DocumentRecord, type Finding, type Repository } from "../model/index.js";


const sync = <A>(f: () => A) => Effect.try({ try: f, catch: failure });
function owners(repo: Repository): Map<string, DocumentRecord> {
  const records = new Map<string, DocumentRecord>();
  for (const path of [...repo.files('docs'), ...repo.files('memory')]) {
    if (!ownerKind(path)) continue;
    const source = repo.read(path);
    if (source === undefined) throw new ConcordError('SourceChanged', `Owner disappeared: ${path}`);
    const record = decodeUncachedDocumentSource(path, source);
    if (record) records.set(path, record);
  }
  return records;
}
function selected(repo: Repository, base: string) {
  const paths = repo.files(`${base}/plans`).filter(path => /\/plans\/[^/]+(?:\.md|\/README\.md)$/u.test(path));
  const entries = new Map(paths.map(path => [path.slice(`${base}/plans/`.length).replace(/(?:\/README)?\.md$/u, ''), path]));
  return { entries, ...designState(repo.read(`${base}/DECISION.md`) ?? '', base, entries) };
}
function sections(source: string, names: readonly string[]): string[] {
  const nodes = fromMarkdown(source).children; let active = false; const values: string[] = [];
  for (const node of nodes) {
    if (node.type === 'heading' && node.depth <= 2) active = node.depth === 2 && names.includes(node.children.map(child => child.type === 'text' ? child.value : '').join(''));
    else if (active) values.push(source.slice(node.position!.start.offset, node.position!.end.offset));
  }
  return values;
}
function constitutionUnits(source: string): Map<string, string> {
  const record = parseConstitution(source); const units = new Map<string, string>();
  let current: string | undefined;
  for (const node of fromMarkdown(record.body).children) {
    if (node.type === 'heading' && node.depth === 2) {
      current = trailingId(record.body, node)?.id;
      if (current !== undefined && !current.startsWith('c-')) current = undefined;
      if (current) units.set(current, record.body.slice(node.position!.start.offset, node.position!.end.offset));
    } else if (current && node.type === 'list' && node.ordered) for (const item of node.children) {
      const first = item.children[0]; const id = first?.type === 'paragraph' ? trailingId(record.body, first)?.id : undefined;
      if (id) units.set(id, record.body.slice(item.position!.start.offset, item.position!.end.offset));
    } else if (current) units.set(current, `${units.get(current)}\n${record.body.slice(node.position!.start.offset, node.position!.end.offset)}`);
  }
  return units;
}

/** Domain endpoint events are derived from owner bytes; no transition registry. */
export function inspectEndpointEvents(beforeRepo: Repository, afterRepo: Repository) {
  const before = owners(beforeRepo), after = owners(afterRepo); const findings: Finding[] = []; const replays: string[] = [];
  const add = (path: string, code: string, message: string) => findings.push({ path, code, message });
  for (const [path, record] of after) {
    const old = before.get(path)?.metadata; const next = record.metadata;
    if (next.kind === 'issue' && next.closure?.kind === 'fixed' && (old?.kind !== 'issue' || old.closure?.kind !== 'fixed' || canonical(old.closure.verification) !== canonical(next.closure.verification))) replays.push(path);
    if (old?.kind === 'memory' && next.kind === 'memory' && old.status !== next.status) {
      if (next.type === 'note' || !((old.status === 'captured' && next.status === 'current') || (old.status === 'current' && next.status === 'superseded'))) add(path, 'InvalidMemoryState', `Illegal Memory transition: ${old.status} -> ${next.status}`);
    }
  }
  // Current trace validation owns surviving inbound references for deleted owners.
  const deleted = [...before.values()].filter(record => !after.has(record.path) && ['issue', 'memory'].includes(record.metadata.kind)).map(record => record.path);
  for (const record of after.values()) for (const link of markdownLinks(record.body, { references: true })) {
    const target = relativeMarkdownLink(record.path, link.url);
    if (target?.kind === 'relative' && deleted.includes(target.path)) add(record.path, 'ReferenceNotFound', `Deleted owner is still referenced: ${target.path}`);
  }
  const oldConstitution = beforeRepo.read('docs/constitution.md'), newConstitution = afterRepo.read('docs/constitution.md');
  if (oldConstitution !== undefined) {
    const previous = parseConstitution(oldConstitution);
    const current = newConstitution === undefined ? undefined : parseConstitution(newConstitution);
    if (previous.metadata.status === 'active' && current?.metadata.status !== 'active') add('docs/constitution.md', 'InvalidConstitutionTransition', 'An active constitution cannot become draft or be deleted');
    const decisions = [...after.values()].filter(record => !before.has(record.path) && record.metadata.kind === 'memory' && record.metadata.type === 'decision');
    if (previous.metadata.status === 'draft' && current?.metadata.status === 'active' && !decisions.some(record => record.metadata.kind === 'memory' && record.metadata.relations.filter(relation => relation.role === 'amends').map(relation => relation.target).includes('docs/constitution.md'))) add('docs/constitution.md', 'ConstitutionDecisionRequired', 'Activation requires a new Decision Memory amending the constitution');
    if (previous.metadata.status === 'active' && current?.metadata.status === 'active') {
      const oldUnits = constitutionUnits(oldConstitution), newUnits = constitutionUnits(newConstitution!);
      for (const id of new Set([...oldUnits.keys(), ...newUnits.keys()])) if (oldUnits.get(id) !== newUnits.get(id)) {
        if (!decisions.some(record => record.metadata.kind === 'memory' && record.metadata.relations.filter(relation => relation.role === 'amends').map(relation => relation.target).includes(`docs/constitution.md#${id}`) && ['适用范围', '理由', '来源', '影响'].every(name => sections(record.body, [name]).join('').trim().length > 0))) add('docs/constitution.md', 'ConstitutionDecisionRequired', `Amendment requires a new Decision with scope, reason, sources, impact and amends #${id}`);
      }
    }
  }
  for (const record of before.values()) if (record.metadata.kind === 'design') {
    const base = posix.dirname(record.path), previous = selected(beforeRepo, base), next = selected(afterRepo, base);
    if (previous.selected !== undefined) {
      if (previous.selected !== next.selected) add(record.path, 'DesignDecisionImmutable', 'A decided Design cannot change or clear Selected');
      const beforePlans = [...previous.entries.keys()].sort();
      const afterPlans = [...next.entries.keys()].sort();
      if (canonical(beforePlans) !== canonical(afterPlans)) add(record.path, 'DesignDecisionImmutable', 'A decided Design cannot change its candidate set');
      for (const page of ['GOALS.md', 'LIMITS.md', 'CASES.md']) if (beforeRepo.read(`${base}/${page}`) !== afterRepo.read(`${base}/${page}`)) add(`${base}/${page}`, 'DesignDecisionImmutable', 'Decided Goals, Limits, or Cases changed');
      for (const [name, oldPath] of previous.entries) {
        const newPath = next.entries.get(name); if (!newPath) continue;
        for (const heading of ['Goals', 'Limits', 'Cases']) if (canonical(sections(beforeRepo.read(oldPath) ?? '', [heading])) !== canonical(sections(afterRepo.read(newPath) ?? '', [heading]))) add(newPath, 'DesignDecisionImmutable', `Decided candidate ${heading} changed`);
      }
      const oldDecision = beforeRepo.read(`${base}/DECISION.md`) ?? '', newDecision = afterRepo.read(`${base}/DECISION.md`) ?? '';
      if (oldDecision !== newDecision) {
        const oldRationale = sections(oldDecision, ['Rationale', '依据']).join('\n\n'), newRationale = sections(newDecision, ['Rationale', '依据']).join('\n\n');
        const appended = newRationale.slice(oldRationale.length);
        if (oldRationale !== newRationale && (!newRationale.startsWith(oldRationale) || !/\d{4}-\d{2}-\d{2}/u.test(appended) || !/(?:来源|Source|https?:\/\/)/iu.test(appended))) add(`${base}/DECISION.md`, 'DesignDecisionImmutable', 'Rationale changes require an appended correction with date and source');
      }
    }
  }
  for (const record of after.values()) if (record.metadata.kind === 'design') {
    const base = posix.dirname(record.path), previous = selected(beforeRepo, base), next = selected(afterRepo, base);
    if (previous.selected === undefined && next.selected !== undefined) {
      const sources = new Map(afterRepo.files(base).map(path => [path, afterRepo.read(path)]));
      findings.push(...validateDesignContent(base, [...next.entries.keys()], sources, next.selected).findings);
    }
  }
  // Moving a Roadmap preserves the package while rebasing its links and inbound references.
  for (const record of before.values()) if (record.metadata.kind === 'roadmap' && !after.has(record.path)) {
    const oldBase = posix.dirname(record.path);
    const candidates = [...after.values()].filter(candidate => candidate.metadata.kind === 'feature' && !before.has(candidate.path));
    const adopted = candidates.find(candidate => candidate.metadata.id === record.metadata.id || candidate.body === record.body);
    if (!adopted) continue;
    const newBase = posix.dirname(adopted.path);
    if (afterRepo.files(oldBase).length) add(adopted.path, 'InvalidRoadmapAdoption', 'Roadmap adoption must remove the source directory');
    for (const oldPath of beforeRepo.files(oldBase)) {
      const newPath = `${newBase}/${oldPath.slice(oldBase.length + 1)}`;
      const oldSource = beforeRepo.read(oldPath);
      if (oldSource === undefined || !oldPath.endsWith('.md')) { add(oldPath, 'InvalidRoadmapAdoption', 'Adoption cannot move attachments or unavailable files'); continue; }
      const expected = rebaseAdoptedMarkdown(oldSource, oldPath, newPath, oldBase, newBase);
      if (afterRepo.read(newPath) !== expected) add(newPath, 'InvalidRoadmapAdoption', 'Moved Roadmap content or outbound links do not satisfy adoption rules');
    }
    for (const path of [...afterRepo.files('docs'), ...afterRepo.files('memory')]) if (/\.md$/u.test(path)) {
      for (const link of markdownLinks(afterRepo.read(path) ?? '', { references: true })) {
        const target = relativeMarkdownLink(path, link.url);
        if (target?.kind === 'relative' && (target.path === oldBase || target.path.startsWith(`${oldBase}/`))) add(path, 'InvalidRoadmapAdoption', 'A moved Roadmap still has an inbound old path reference');
      }
    }
  }
  return { findings, replays, deleted };
}

export const checkSince = (root: string | undefined, baseInput: string, cache: 'use' | 'off' = 'off') => Effect.scoped(Effect.gen(function* () {
  const repo = yield* openReadRepository(root, { access: 'read', persistentCache: 'off', optimistic: true });
  const base = yield* sync(() => {
    const commit = resolveCommit(repo.root, baseInput, 'InvalidBase');
    try { git(repo.root, ['merge-base', '--is-ancestor', commit, 'HEAD']); } catch { throw new ConcordError('InvalidBase', 'Baseline must be an ancestor of HEAD'); }
    return commit;
  });
  const identity = yield* sync(() => worktreeIdentity(repo));
  const current = yield* checkCurrentProject(repo.root, cache);
  const since = { base, target: 'worktree' as const, scope: 'endpoints' as const };
  const findings = [...current.findings]; let complete = current.complete;
  const replays = new Set<string>();
  const eventResult = yield* Effect.result(sync(() => repo.snapshot(() => inspectEndpointEvents(commitRepository(repo, base), repo))));
  if (eventResult._tag === 'Failure') { complete = false; findings.push({ category: 'relation', path: '.', code: eventResult.failure.code, message: eventResult.failure.message }); }
  else {
    findings.push(...eventResult.success.findings.map(finding => ({ ...finding, category: 'relation' as const })));
    for (const issue of eventResult.success.replays) {
      const result = yield* Effect.result(replayFix(repo, issue));
      if (result._tag === 'Failure') { complete = false; findings.push({ category: 'relation', path: issue, code: result.failure.code, message: result.failure.message }); }
      else replays.add(issue);
    }
  }
  const stable = yield* Effect.result(sync(() => worktreeIdentity(repo)));
  if (stable._tag === 'Failure' || stable.success !== identity) { complete = false; findings.push({ category: 'relation', path: '.', code: 'FileChangedSinceRead', message: 'Target worktree changed during endpoint checks' }); }
  return { ...current, since, complete, ok: complete && findings.length === 0, findings, verifications: current.verifications.map(item => ({ ...item, verified: replays.has(item.path) ? 'replayed' as const : 'recorded' as const })) };
}));
