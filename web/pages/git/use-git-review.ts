import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { GitDiff, GitEntry } from '../../../src/git-view';
import { useIsMobile } from '../../hooks/use-mobile';
import { useWorkspace } from '../../workspace';
import { entriesFor, fileTree, firstArea, sortedFiles, validArea, type Category, type Selection } from './model';

export function useGitReview() {
  const { api, git, snapshot, refresh, notify } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<'split' | 'unified'>('unified');
  const [navigationOpen, setNavigationOpen] = useState(false);
  const isMobile = useIsMobile();
  const remembered = useRef<Partial<Record<Category, Selection>>>({});
  const positions = useRef(new Map<string, number>());
  const docs = useMemo(() => git?.entries.filter(entry => entry.path.startsWith('docs/') || entry.previousPath?.startsWith('docs/')) ?? [], [git]);
  const tests = useMemo(() => {
    const files = new Set(snapshot.cases.map(item => item.file));
    const roots = snapshot.project?.testRoots ?? [];
    const isTest = (path: string) => files.has(path) || roots.some(root => root === '.' || path === root || path.startsWith(root.replace(/\/$/, '') + '/'));
    return git?.entries.filter(entry => isTest(entry.path) || !!entry.previousPath && isTest(entry.previousPath)) ?? [];
  }, [git, snapshot.cases, snapshot.project]);
  const requested = params.get('path');
  const tab: Category = params.get('tab') === 'tests' || !params.has('tab') && tests.some(item => item.path === requested) ? 'tests' : 'docs';
  const entries = tab === 'docs' ? docs : tests;
  const tree = useMemo(() => fileTree(entries), [entries]);
  const entry = entries.find(item => item.path === requested) ?? entries.find(item => item.path === remembered.current[tab]?.path) ?? sortedFiles(tree)[0];
  const requestedArea = params.get('area') ?? (entry?.path === remembered.current[tab]?.path ? remembered.current[tab]?.area : null) ?? null;
  const area = entry ? validArea(requestedArea) && entriesFor([entry], requestedArea).length ? requestedArea : firstArea(entry) : undefined;
  const path = entry?.path;
  const rawLine = params.get('line');
  const line = rawLine && /^[1-9]\d*$/.test(rawLine) && Number.isSafeInteger(Number(rawLine)) && requested === path ? Number(rawLine) : undefined;
  const readingKey = `${tab}:${path}:${area}`;
  useEffect(() => { if (path && area) remembered.current[tab] = { path, area }; }, [tab, path, area]);
  useEffect(() => {
    setError('');
    if (!path || !area) { setDiff(null); return; }
    const controller = new AbortController();
    void api.gitDiff(path, area, controller.signal).then(value => {
      if (!controller.signal.aborted) setDiff(value);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [api, git, path, area]);
  const visibleDiff = diff && diff.path === path && diff.area === area ? diff : null;
  const select = (entry: GitEntry, selectedArea = firstArea(entry), selectedLine?: number) => {
    setParams({ tab, path: entry.path, area: selectedArea, ...(selectedLine ? { line: String(selectedLine) } : {}) });
    setNavigationOpen(false);
  };
  const baseline = new Set(git?.baselineCaseIds ?? []);
  const addedCases = tab === 'tests' && git?.baselineCaseIds ? snapshot.cases.filter(item => !baseline.has(item.id)) : [];

  function changeCategory(value: string): void {
    const category: Category = value === 'tests' ? 'tests' : 'docs';
    const saved = remembered.current[category];
    setParams({ tab: category, ...(saved ? { path: saved.path, area: saved.area } : {}) });
  }
  function refreshGit(): void {
    void refresh().catch(cause => notify(cause instanceof Error ? cause.message : String(cause), 'error'));
  }
  return { git, view, setView, navigationOpen, setNavigationOpen, isMobile, docs, tests, tab, tree, entry, area, path, line, readingKey, visibleDiff, error, select, addedCases, changeCategory, refreshGit, positions };
}
