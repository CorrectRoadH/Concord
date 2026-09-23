import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { GitDiff, GitEntry } from '../../../src/git-view';
import { urlChoice } from '../../hooks/use-url-navigation';
import { useWorkspace } from '../../workspace';
import { entriesFor, fileTree, firstArea, sortedFiles, validArea, type Category } from './model';

export function useGitReview() {
  const { api, git, snapshot, refresh, notify } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const [diff, setDiff] = useState<GitDiff | null>(null);
  const [error, setError] = useState('');
  const view = urlChoice(params.get('view'), ['split', 'unified'], 'unified');
  const setView = (value: string) => { const next = new URLSearchParams(params); next.set('view', value === 'split' ? 'split' : 'unified'); setParams(next); };
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
  const entry = entries.find(item => item.path === requested) ?? entries.find(item => item.path === params.get(`${tab}Path`)) ?? sortedFiles(tree)[0];
  const requestedArea = params.get('area') ?? (entry?.path === params.get(`${tab}Path`) ? params.get(`${tab}Area`) : null) ?? null;
  const area = entry ? validArea(requestedArea) && entriesFor([entry], requestedArea).length ? requestedArea : firstArea(entry) : undefined;
  const path = entry?.path;
  const rawLine = params.get('line');
  const line = rawLine && /^[1-9]\d*$/.test(rawLine) && Number.isSafeInteger(Number(rawLine)) && requested === path ? Number(rawLine) : undefined;
  const readingKey = `${tab}:${path}:${area}`;
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
    const next = new URLSearchParams(params);
    next.set('tab', tab); next.set('path', entry.path); next.set('area', selectedArea);
    next.set(`${tab}Path`, entry.path); next.set(`${tab}Area`, selectedArea);
    next.delete('line'); if (selectedLine) next.set('line', String(selectedLine));
    setParams(next);
  };
  const baseline = new Set(git?.baselineCaseIds ?? []);
  const addedCases = tab === 'tests' && git?.baselineCaseIds ? snapshot.cases.filter(item => !baseline.has(item.id)) : [];

  function changeCategory(value: string): void {
    const category: Category = value === 'tests' ? 'tests' : 'docs';
    const next = new URLSearchParams(params);
    if (path && area) { next.set(`${tab}Path`, path); next.set(`${tab}Area`, area); }
    next.set('tab', category); next.delete('line');
    next.delete('path'); next.delete('area');
    const savedPath = params.get(`${category}Path`), savedArea = params.get(`${category}Area`);
    if (savedPath) next.set('path', savedPath);
    if (savedArea) next.set('area', savedArea);
    setParams(next);
  }
  function refreshGit(): void {
    void refresh().catch(cause => notify(cause instanceof Error ? cause.message : String(cause), 'error'));
  }
  return { git, view, setView, docs, tests, tab, tree, entry, area, path, line, readingKey, visibleDiff, error, select, addedCases, changeCategory, refreshGit, positions };
}
