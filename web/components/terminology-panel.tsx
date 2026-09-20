// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { useEffect, useMemo, useState } from 'react';
import type { DocumentRecord } from '../../src/shared';
import type { ViewFile } from '../../src/view-contract';
import { contractIdentities } from '../pages/operations';
import { useWorkspace } from '../workspace';
import { PanelEmpty, PanelHeader, RecordList, RecordItem } from './content-layout';

interface Term {
  readonly key: string;
  readonly preferred: string;
  readonly english: string;
  readonly meaning: string;
}

function linkedTerms(source: string, targets: ReadonlySet<string>): readonly Term[] {
  const terms: Term[] = [];
  for (const [index, line] of source.split('\n').entries()) {
    if (!line.trimStart().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    if (cells.length < 4 || cells.every(cell => /^:?-+:?$/u.test(cell))) continue;
    const destinations = [...cells.at(-1)!.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/gu)].map(match => match[1]!.split('#')[0]!);
    if (!destinations.some(destination => {
      try {
        const path = decodeURIComponent(new URL(destination, 'https://concord.invalid/docs/concepts.md').pathname).replace(/^\/+/, '');
        return targets.has(path);
      } catch { return false; }
    })) continue;
    terms.push({ key: `${index}:${cells[0]}`, preferred: cells[0]!, english: cells[1]!, meaning: cells[2]! });
  }
  return terms;
}

export function TerminologyPanel({ document }: { readonly document: DocumentRecord }) {
  const { api, snapshot } = useWorkspace();
  const [concepts, setConcepts] = useState<ViewFile | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setConcepts(null); setError('');
    void api.file('docs/concepts.md', controller.signal).then(setConcepts).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => controller.abort();
  }, [api]);
  const targets = contractIdentities(snapshot, document);
  const terms = useMemo(() => linkedTerms(concepts?.body ?? '', targets), [concepts?.body, targets]);
  return <><PanelHeader title="术语" />
    {error ? <div role="alert" className="form-error">术语表读取失败：{error}</div>
      : !concepts ? <p role="status">正在读取术语表…</p>
      : terms.length === 0 ? <PanelEmpty title="尚未关联术语">请在 docs/concepts.md 的词条契约列中链接当前契约。</PanelEmpty>
      : <RecordList>{terms.map(term => <RecordItem key={term.key}>
        <div className="flex flex-wrap items-baseline gap-2"><strong>{term.preferred}</strong><span className="text-sm text-muted-foreground">{term.english}</span></div>
        <p className="mb-0 mt-2">{term.meaning}</p>
      </RecordItem>)}</RecordList>}
  </>;
}
