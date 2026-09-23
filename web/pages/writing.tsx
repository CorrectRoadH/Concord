// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/manage-writing.md
// @concord-implements docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Folder, Trash2 } from 'lucide-react';
import { createPortal, flushSync } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { defaultWritingPolicy } from '../../src/writing-defaults';
import type { ViewAction } from '../../src/view-contract';
import type { BannedTerm, WritingPolicy } from '../../src/writing-policy';
import type { ConceptCatalog, ConceptDefinition } from '../../src/concepts-schema';
import type { checkWriting } from '../../src/writing';
import { useWorkspace } from '../workspace';
import { ContentSidebar } from '../components/content-sidebar';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { ContentSection, PanelHeader, PanelEmpty, RecordList, RecordItem, RecordDetails, Surface } from '../components/content-layout';

type ConceptName = ConceptDefinition['names'][string];
type Concept = ConceptDefinition;
type Catalog = ConceptCatalog;
type Scope = { scope: string; policyPath: string; catalogPath: string; hasPolicy: boolean; hasCatalog: boolean };
type Aggregate = { catalogs: readonly { path: string; scope: string; digest: string; catalog: Catalog }[]; concepts: readonly { reference: string; path: string; scope: string; concept: Concept }[]; diagnostics: readonly { code: string; message: string; sources: readonly string[]; scope?: string }[]; inputDigest: string };
type Show<T> = { state: 'missing' | 'invalid' | 'valid'; path: string; scope: string; digest: string | null; source: string | null; diagnostic?: string; policy?: T | null; catalog?: T | null };
type Receipt<T> = { path: string; scope: string; digest: string; source: string; policy?: T; catalog?: T };
type Report = ReturnType<typeof checkWriting>;
const policyPath = (scope: string) => `${scope}/concord-writing.json`;
const catalogPath = (scope: string) => `${scope}/concepts.json`;
const emptyPolicy = (): WritingPolicy => ({ format: 'concord.writing/v2', bannedTerms: [] });
const emptyCatalog = (): Catalog => ({ format: 'concord.concepts/v1', concepts: [] });
const lines = (text: string) => text.split(/\r?\n/u).map(value => value.trim()).filter(Boolean);
const listed = (values?: readonly string[]) => (values ?? []).join('\n');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const action = (value: unknown): ViewAction => value as ViewAction;

function useOwner<T>(kind: 'policy' | 'catalog', scope: string, api: ReturnType<typeof useWorkspace>['api'], changed: () => void) {
  const path = kind === 'policy' ? policyPath(scope) : catalogPath(scope);
  const [remote, setRemote] = useState<Show<T> | null>(null);
  const [draft, setDraft] = useState<T | null>(null);
  const [baseline, setBaseline] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const currentPath = useRef(path);
  currentPath.current = path;
  const inFlight = useRef<Promise<void> | null>(null);
  const dirty = open && draft !== null && !same(draft, baseline);
  const latest = useRef({ remote, draft, baseline, dirty });
  latest.current = { remote, draft, baseline, dirty };
  const invalidate = useCallback(() => {
    generation.current++;
    setRemote(null); setDraft(null); setBaseline(null); setOpen(false); setLoading(true); setSaving(false); setError('');
  }, []);
  const load = useCallback(async (expected?: string) => {
    const requestedPath = currentPath.current;
    const ticket = ++generation.current;
    setLoading(true);
    try {
      const value = await api.action(action({ action: kind === 'policy' ? 'writing.show' : 'concepts.show', path: requestedPath })) as Show<T>;
      if (generation.current !== ticket || currentPath.current !== requestedPath || value.path !== requestedPath) return;
      if (expected !== undefined && value.digest !== expected) {
        setError('保存后来源又被外部修改。草稿仍绑定本次提交摘要；请审阅外部变化。');
        return;
      }
      setRemote(value);
      if (expected === undefined) {
        const item = kind === 'policy' ? value.policy : value.catalog;
        setDraft(value.state === 'valid' ? item ?? null : null);
        setBaseline(value.state === 'valid' ? item ?? null : null);
        setOpen(value.state === 'valid');
      }
      setError('');
    } catch (cause) { if (generation.current === ticket && currentPath.current === requestedPath) setError(errorText(cause)); }
    finally { if (generation.current === ticket && currentPath.current === requestedPath) setLoading(false); }
  }, [api, kind]);
  useEffect(() => { void load(); }, [path, load]);
  const edit = (value: T) => { changed(); setDraft(value); };
  const initialize = (value: T) => { changed(); setDraft(value); setBaseline(null); setOpen(true); };
  const save = async () => {
    const state = latest.current;
    if (!state.remote || !state.draft || !state.dirty || inFlight.current) return;
    const submitted = state.draft;
    const expectedDigest = state.remote.digest;
    const requestedPath = currentPath.current;
    const ticket = ++generation.current;
    setSaving(true); setError(''); changed();
    const pending = (async () => {
      try {
        const result = await api.action(action(kind === 'policy'
          ? { action: 'writing.set', path: requestedPath, policy: submitted, expectedDigest }
          : { action: 'concepts.set', path: requestedPath, catalog: submitted, expectedDigest })) as Receipt<T>;
        if (generation.current !== ticket || currentPath.current !== requestedPath || result.path !== requestedPath) return;
        const committed = kind === 'policy' ? result.policy : result.catalog;
        if (!committed) throw new Error('保存响应缺少已提交 owner。');
        setRemote({ state: 'valid', path: result.path, scope: result.scope, digest: result.digest, source: result.source });
        setBaseline(committed);
        setDraft(previous => same(previous, submitted) ? committed : previous);
        void load(result.digest);
      } catch (cause) { if (generation.current === ticket && currentPath.current === requestedPath) setError(errorText(cause)); }
      finally { if (currentPath.current === requestedPath) setSaving(false); }
    })();
    inFlight.current = pending;
    await pending;
    if (inFlight.current === pending) inFlight.current = null;
  };
  const discard = () => {
    const saved = latest.current;
    generation.current++;
    flushSync(() => { setDraft(saved.baseline); setBaseline(saved.baseline); setOpen(saved.remote?.state === 'valid'); setRemote(saved.remote); setLoading(false); setError(''); });
  };
  return { path, remote, draft, baseline, open, loading, saving, error, dirty, latest, edit, initialize, save, load, invalidate, discard, inFlight };
}

export function WritingPage() {
  const { api, registerAutoSave, reportDirty } = useWorkspace();
  const location = useLocation();
  const view = location.pathname === '/writing' ? 'lint' : 'terms';
  const selectionInitialized = useRef(false);
  const [editingIndex, setEditingIndex] = useState(0);
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const [scope, setScope] = useState('docs');
  const [scopeInput, setScopeInput] = useState('');
  const [pendingScope, setPendingScope] = useState<{ scope: string; index: number; id?: string } | null>(null);
  const [ancestors, setAncestors] = useState<readonly { path: string; policy: WritingPolicy }[]>([]);
  const [inheritanceError, setInheritanceError] = useState('');
  const [reloadVersion, setReloadVersion] = useState(0);
  const [scopes, setScopes] = useState<readonly Scope[]>([]);
  const [aggregate, setAggregate] = useState<Aggregate | null>(null);
  const aggregateCurrent = useRef<Aggregate | null>(null);
  aggregateCurrent.current = aggregate;
  const [aggregateError, setAggregateError] = useState('');
  const [sourceWarning, setSourceWarning] = useState('');
  const [aggregateQuery, setAggregateQuery] = useState('');
  const [banQuery, setBanQuery] = useState('');
  const [newLanguages, setNewLanguages] = useState<Record<number, string>>({});
  const [report, setReport] = useState<Report | null>(null);
  const [checkError, setCheckError] = useState('');
  const [checking, setChecking] = useState(false);
  const reportGeneration = useRef(0);
  const aggregateGeneration = useRef(0);
  const clearReport = () => { reportGeneration.current++; setReport(null); setCheckError(''); setChecking(false); };
  const policy = useOwner<WritingPolicy>('policy', scope, api, clearReport);
  const catalog = useOwner<Catalog>('catalog', scope, api, clearReport);
  const dirty = policy.dirty || catalog.dirty;
  const latest = useRef({ policy, catalog, dirty });
  latest.current = { policy, catalog, dirty };
  const loadIndex = useCallback(async () => {
    try { const result = await api.action(action({ action: 'writing.index' })) as { scopes: readonly Scope[] }; setScopes(result.scopes); }
    catch (cause) { setAggregateError(errorText(cause)); }
  }, [api]);
  const loadAggregate = useCallback(async () => {
    const ticket = ++aggregateGeneration.current;
    try {
      const result = await api.action(action({ action: 'concepts.index' })) as Aggregate;
      if (aggregateGeneration.current !== ticket) return;
      if (aggregateCurrent.current && aggregateCurrent.current.inputDigest !== result.inputDigest) {
        setSourceWarning('术语来源已变化；旧检查结果只代表先前输入快照。请审阅来源并重新检查。');
        reportGeneration.current++;
        setReport(null);
        setCheckError('');
        setChecking(false);
      }
      aggregateCurrent.current = result;
      setAggregate(result);
      setAggregateError('');
    } catch (cause) { if (aggregateGeneration.current === ticket) { setAggregateError(errorText(cause)); } }
  }, [api]);
  useEffect(() => { void loadIndex(); void loadAggregate(); }, [scope, loadIndex, loadAggregate]);
  useEffect(() => {
    let active = true;
    setAncestors([]); setInheritanceError('');
    const parts = scope.split('/');
    const paths = parts.slice(0, -1).map((_, index) => policyPath(parts.slice(0, index + 1).join('/')));
    void Promise.all(paths.map(async path => {
      const owner = await api.action(action({ action: 'writing.show', path })) as Show<WritingPolicy>;
      if (owner.state === 'invalid') throw new Error(`${path}: ${owner.diagnostic}`);
      return owner.state === 'valid' && owner.policy ? { path, policy: owner.policy } : null;
    })).then(owners => { if (active) setAncestors(owners.filter((owner): owner is { path: string; policy: WritingPolicy } => owner !== null)); })
      .catch(cause => { if (active) setInheritanceError(errorText(cause)); });
    return () => { active = false; };
  }, [api, scope, reloadVersion]);
  const inheritedPolicy = Object.assign({}, ...ancestors.map(owner => owner.policy)) as Partial<WritingPolicy>;
  const draftOwner = useMemo(() => ({
    isDirty: () => latest.current.dirty,
    flush: async () => {
      await Promise.allSettled([latest.current.policy.inFlight.current, latest.current.catalog.inFlight.current].filter((item): item is Promise<void> => item !== null));
      if (latest.current.dirty) throw new Error('写作规则或术语表尚未显式保存。');
    },
    discard: async () => { latest.current.policy.discard(); latest.current.catalog.discard(); reportGeneration.current++; setReport(null); setCheckError(''); setChecking(false); },
  }), []);
  useLayoutEffect(() => registerAutoSave(draftOwner), [draftOwner, registerAutoSave]);
  useLayoutEffect(() => reportDirty(draftOwner), [dirty, draftOwner, reportDirty]);
  const switchScope = (next: string, index = 0, id?: string) => {
    if (!next) return;
    selectionInitialized.current = true;
    if (next === scope) { setRequestedId(catalog.loading ? id ?? null : null); setEditingIndex(index); return; }
    if (latest.current.dirty || latest.current.policy.inFlight.current || latest.current.catalog.inFlight.current) { setPendingScope({ scope: next, index, id }); return; }
    policy.invalidate(); catalog.invalidate(); aggregateGeneration.current++; clearReport();
    setSourceWarning(''); setAggregateError(''); setScope(next); setBanQuery(''); setEditingIndex(index); setRequestedId(id ?? null); setNewLanguages({});
  };
  const discardAndSwitch = () => {
    const next = pendingScope;
    if (!next || policy.inFlight.current || catalog.inFlight.current) return;
    setPendingScope(null);
    policy.discard(); catalog.discard();
    switchScope(next.scope, next.index, next.id);
  };
  useEffect(() => {
    if (view !== 'terms' || selectionInitialized.current || !aggregate || catalog.loading) return;
    selectionInitialized.current = true;
    if (catalog.remote?.state !== 'invalid' && !catalog.draft?.concepts.length && aggregate.concepts[0]) switchScope(aggregate.concepts[0].scope, 0, aggregate.concepts[0].concept.id);
  }, [aggregate, catalog.loading, view]);
  useEffect(() => {
    if (requestedId === null || catalog.loading || !catalog.draft) return;
    setEditingIndex(catalog.draft.concepts.findIndex(item => item.id === requestedId));
    setRequestedId(null);
  }, [requestedId, catalog.loading, catalog.draft]);
  const addConcept = () => {
    if (catalog.loading || catalog.saving || catalog.remote?.state === 'invalid') return;
    selectionInitialized.current = true;
    setRequestedId(null);
    const current = catalog.draft ?? emptyCatalog();
    setEditingIndex(current.concepts.length);
    const next = { ...current, concepts: [...current.concepts, { id: '', definition: '', names: { en: { preferred: '' } } }] };
    if (catalog.draft) catalog.edit(next); else catalog.initialize(next);
  };
  const reload = () => { if (latest.current.dirty) return; setReloadVersion(value => value + 1); clearReport(); void policy.load(); void catalog.load(); void loadIndex(); void loadAggregate(); };
  const policyField = <K extends keyof WritingPolicy>(key: K, value: WritingPolicy[K]) => { if (policy.draft) policy.edit({ ...policy.draft, [key]: value }); };
  const banField = (index: number, key: keyof BannedTerm, value: string | readonly string[] | undefined) => { if (policy.draft) policy.edit({ ...policy.draft, bannedTerms: policy.draft.bannedTerms.map((item, at) => at === index ? { ...item, [key]: value } : item) }); };
  const updateConcept = (index: number, update: (item: Concept) => Concept) => { if (catalog.draft) catalog.edit({ ...catalog.draft, concepts: catalog.draft.concepts.map((item, at) => at === index ? update(item) : item) }); };
  const updateName = (index: number, language: string, update: (name: ConceptName) => ConceptName) => updateConcept(index, item => ({ ...item, names: { ...item.names, [language]: update(item.names[language]!) } }));
  const check = async () => {
    const ticket = ++reportGeneration.current;
    setChecking(true); setReport(null); setCheckError('');
    try { const result = await api.action(action({ action: 'writing.check' })) as Report; if (reportGeneration.current === ticket) setReport(result); }
    catch (cause) { if (reportGeneration.current === ticket) setCheckError(errorText(cause)); }
    finally { if (reportGeneration.current === ticket) setChecking(false); }
  };
  const shownBans = policy.draft?.bannedTerms.map((ban, index) => ({ ban, index })).filter(({ ban }) => `${ban.term} ${ban.use} ${ban.why}`.toLocaleLowerCase().includes(banQuery.toLocaleLowerCase())) ?? [];
  const catalogEntries = [...(aggregate?.catalogs.filter(item => item.scope !== scope) ?? []), ...(catalog.draft ? [{ scope, path: catalog.path, catalog: catalog.draft }] : aggregate?.catalogs.filter(item => item.scope === scope) ?? [])];
  const shownConcepts = catalogEntries.sort((a, b) => a.path.localeCompare(b.path)).flatMap(item => item.catalog.concepts.map((concept, index) => ({ scope: item.scope, path: item.path, concept, index }))).filter(item => aggregateQuery.trim() !== '' || item.scope === scope);
  const selectedIndex = requestedId === null ? Math.min(editingIndex, (catalog.draft?.concepts.length ?? 0) - 1) : catalog.draft?.concepts.findIndex(item => item.id === requestedId) ?? -1;
  const conceptTitle = (concept: Concept) => concept.names.zh?.preferred ?? concept.names['zh-CN']?.preferred ?? concept.names.en?.preferred ?? concept.id;
  const reloadButton = <Button variant="outline" disabled={dirty || policy.saving || catalog.saving} onClick={reload}>重新载入</Button>;
  const navigationHost = document.getElementById('content-navigation');
  return <div className="writing-page">
    {navigationHost && createPortal(<ContentSidebar model={{
      label: view === 'terms' ? '术语' : '写作', title: view === 'terms' ? '术语' : '写作',
      filter: view === 'terms' ? { label: '筛选术语', placeholder: '搜索名称、别名或定义…', value: aggregateQuery, onChange: setAggregateQuery } : { label: '筛选适用范围', placeholder: '按适用范围筛选…' },
      groups: [{ id: 'scopes', label: '适用范围列表', heading: '适用范围', filterable: view !== 'terms',
        items: [...new Set(['docs', ...scopes.map(item => item.scope), scope])].map(path => ({ id: path, title: path === 'docs' ? '整个项目' : path.replace(/^docs\//u, ''), active: scope === path, icon: <Folder size={16} />, onSelect: () => switchScope(path) })),
        footer: (close: () => void) => <form className="writing-directory-add" onSubmit={event => { event.preventDefault(); close(); switchScope(scopeInput.trim()); }}><Input aria-label="新适用范围" value={scopeInput} onChange={event => setScopeInput(event.target.value)} placeholder="其他目录，如 docs/feature/example" /><Button type="submit" variant="outline" disabled={!scopeInput.trim()}>打开范围</Button></form>,
      }, ...(view === 'terms' ? [{ id: 'terms', label: '术语列表', heading: '术语',
        actions: (close: () => void) => <div className="terminology-actions"><Button variant="outline" disabled={catalog.loading || catalog.saving || catalog.remote?.state === 'invalid'} onClick={() => { addConcept(); close(); }}>新增术语</Button><Button variant="ghost" onClick={() => void loadAggregate()}>刷新列表</Button></div>,
        items: shownConcepts.map(item => ({ id: `${item.path}:${item.index}`, title: conceptTitle(item.concept) || '新术语', searchText: `${item.concept.id} ${item.concept.definition} ${Object.values(item.concept.names).flatMap(name => [name.preferred, ...(name.aliases ?? []), ...(name.deprecated ?? [])]).join(' ')}`, active: scope === item.scope && selectedIndex === item.index, icon: <BookOpen size={16} />, onSelect: () => switchScope(item.scope, item.index, item.concept.id) })),
        emptyMessage: aggregate ? '暂无匹配术语' : '正在载入术语…',
        footer: <>{aggregateError && <p role="alert">{aggregateError}<Button onClick={() => void loadAggregate()}>重试</Button></p>}{!!aggregate?.diagnostics.length && <div role="alert">{aggregate.diagnostics.map((item, index) => <p key={index}>{item.message}（{item.sources.join('、')}）</p>)}</div>}</>,
      }] : [])],
    }} />, navigationHost)}
    {pendingScope && <Surface role="dialog" aria-label="切换范围并丢弃未保存内容？" className="writing-switch-dialog p-4"><strong>切换范围并丢弃未保存内容？</strong><p>当前写作规则或术语表仍有草稿。</p><div className="button-row"><Button variant="outline" onClick={() => setPendingScope(null)}>留在当前范围</Button><Button variant="destructive" disabled={policy.saving || catalog.saving} onClick={discardAndSwitch}>丢弃并切换</Button></div></Surface>}
    {sourceWarning && <p role="alert" className="form-error">{sourceWarning}</p>}
    <div hidden={view !== 'terms'}>
      <section aria-label="术语详情" className="terminology-detail">
    <section aria-label="术语表编辑" className="terminology-editor"><div role="toolbar" aria-label="术语操作" className="button-row justify-end mb-3">{reloadButton}{catalog.draft && <Button variant="outline" disabled={!catalog.dirty || catalog.saving} onClick={() => void catalog.save().then(() => { void loadIndex(); void loadAggregate(); })}>{catalog.saving ? '正在保存…' : '保存术语'}</Button>}</div>
      {catalog.loading && !catalog.remote && <p role="status">正在载入术语…</p>}{catalog.error && <p role="alert" className="form-error">{catalog.error}</p>}
      {catalog.remote?.state === 'invalid' && <div><h3>术语表格式错误</h3><p role="alert">{catalog.remote.diagnostic}</p><p>原文摘要：<code>{catalog.remote.digest}</code></p><pre>{catalog.remote.source}</pre>{!catalog.open && <Button variant="outline" onClick={() => catalog.initialize(emptyCatalog())}>修复术语表</Button>}</div>}
      {catalog.draft && catalog.open && <><RecordList className="terminology-fields">{catalog.draft.concepts.map((concept, index) => <RecordItem hidden={index !== selectedIndex} key={index}><fieldset className="writing-fields"><legend className="sr-only">术语 {index + 1}</legend><label>定义<Textarea aria-label={`术语定义 ${index + 1}`} value={concept.definition} onChange={event => updateConcept(index, item => ({ ...item, definition: event.target.value }))} placeholder="这个术语指什么？" /></label>{Object.entries(concept.names).map(([language, name]) => <ContentSection key={language} title={({ zh: '中文', 'zh-CN': '简体中文', en: 'English' } as Record<string, string>)[language] ?? language} summary={<Button variant="ghost" size="icon" aria-label={`删除语言 ${language}`} title={`删除语言 ${language}`} onClick={() => updateConcept(index, item => { const names = { ...item.names }; delete names[language]; return { ...item, names }; })}><Trash2 size={14} /></Button>}><div className="writing-options"><label>首选名称<Input aria-label={`术语 ${index + 1} ${language} 首选名称`} value={name.preferred} onChange={event => updateName(index, language, item => ({ ...item, preferred: event.target.value }))} /></label><label>允许别名（每行一项）<Textarea aria-label={`术语 ${index + 1} ${language} 允许别名`} value={listed(name.aliases)} onChange={event => updateName(index, language, item => ({ ...item, aliases: lines(event.target.value) }))} /></label><label>弃用名称（每行一项）<Textarea aria-label={`术语 ${index + 1} ${language} 弃用名称`} value={listed(name.deprecated)} onChange={event => updateName(index, language, item => ({ ...item, deprecated: lines(event.target.value) }))} /></label></div></ContentSection>)}<div className="button-row"><Input className="w-40" aria-label={`术语 ${index + 1} 新语言代码`} value={newLanguages[index] ?? ''} onChange={event => setNewLanguages(previous => ({ ...previous, [index]: event.target.value }))} placeholder="zh-CN" /><Button variant="outline" disabled={!newLanguages[index]?.trim() || newLanguages[index]?.trim() in concept.names} onClick={() => { const language = newLanguages[index]!.trim(); updateConcept(index, item => ({ ...item, names: { ...item.names, [language]: { preferred: '' } } })); setNewLanguages(previous => ({ ...previous, [index]: '' })); }}>添加语言</Button><Button variant="outline" onClick={() => catalog.edit({ ...catalog.draft!, concepts: catalog.draft!.concepts.filter((_, at) => at !== index) })}>删除术语 {index + 1}</Button></div><div className="terminology-advanced"><label>标识 ID<Input aria-label={`术语 ID ${index + 1}`} value={concept.id} onChange={event => updateConcept(index, item => ({ ...item, id: event.target.value }))} /></label><code>{catalog.path}#{concept.id}</code></div></fieldset></RecordItem>)}</RecordList><p role="status">{catalog.dirty ? '术语有未保存修改。' : '术语已保存。'}</p></>}
      {catalog.draft && <label className="terminology-imports">本目录引用的术语<Textarea rows={1} aria-label="显式导入引用" value={listed(catalog.draft.imports)} placeholder="每行一个术语引用，如 docs/concepts.json#contract" onChange={event => { const values = lines(event.target.value); catalog.edit({ ...catalog.draft!, imports: values.length ? values : undefined }); }} /><span className="field__hint">用于复用其他目录的定义，与本目录术语一起保存。</span></label>}
      {catalog.draft && selectedIndex < 0 && catalog.draft.concepts.length > 0 && <PanelEmpty title="所选术语已被移除，请刷新列表重新选择。" />}
      {((catalog.draft && !catalog.draft.concepts.length) || (catalog.remote?.state === 'missing' && !catalog.draft)) && <PanelEmpty title="此目录暂无术语">点击新增术语即可开始填写。</PanelEmpty>}
    </section>
      </section>
    </div>
    <div hidden={view === 'terms'}>
    <section hidden={view !== 'lint'} aria-label="写作规则编辑" className="content-section"><div role="toolbar" aria-label="写作操作" className="button-row justify-end mb-3">{reloadButton}{policy.draft && <Button variant="outline" disabled={!policy.dirty || policy.saving} onClick={() => void policy.save().then(() => { void loadIndex(); void loadAggregate(); })}>{policy.saving ? '正在保存…' : '保存规则'}</Button>}</div>
      {scope !== 'docs' && <div aria-label="上级写作规则"><p>本范围沿用上级写作规则；需要调整时可添加本范围的规则。</p>{inheritanceError ? <p role="alert">{inheritanceError}</p> : <><p>上级规则来源：{ancestors.map(owner => owner.path).join('、') || '无'}。句子长度：{inheritedPolicy.sentenceLength ?? '不限制'}；段落长度：{inheritedPolicy.paragraphLength ?? '不限制'}；禁用表达：{ancestors.reduce((count, owner) => count + owner.policy.bannedTerms.length, 0)} 条。未使用术语：{inheritedPolicy.unusedConcepts ? '检查' : '不检查'}。</p></>}</div>}
      {policy.loading && !policy.remote && <p role="status">正在载入写作规则…</p>}{policy.error && <p role="alert" className="form-error">{policy.error}</p>}
      {policy.remote?.state === 'missing' && !policy.open && <PanelEmpty title={scope === 'docs' ? '尚未采用写作规则' : '沿用上级规则，尚无本范围的调整'}><Button variant="outline" onClick={() => policy.initialize(scope === 'docs' ? structuredClone(defaultWritingPolicy) : emptyPolicy())}>添加规则</Button></PanelEmpty>}
      {policy.remote?.state === 'invalid' && <div><h3>写作规则格式错误或需要迁移</h3><p role="alert">{policy.remote.diagnostic}</p><p>原文摘要：<code>{policy.remote.digest}</code></p><pre>{policy.remote.source}</pre>{!policy.open && !policy.remote.diagnostic?.includes('SVG writing checks were removed') && <Button variant="outline" onClick={() => policy.initialize(scope === 'docs' ? structuredClone(defaultWritingPolicy) : emptyPolicy())}>修复规则</Button>}</div>}
      {policy.draft && policy.open && <><div className="writing-scan-roots"><p className="field__hint">扫描目录留空时检查当前范围。</p><label>扫描目录（每行一项）<Textarea aria-label="扫描目录" value={listed(policy.draft.roots)} onChange={event => { const values = lines(event.target.value); policyField('roots', values.length ? values as [string, ...string[]] : undefined); }} /></label></div>
        <div className="writing-options"><label>句子长度<select aria-label="句子长度设置" value={policy.draft.sentenceLength === undefined ? 'inherit' : policy.draft.sentenceLength === null ? 'clear' : 'value'} onChange={event => policyField('sentenceLength', event.target.value === 'inherit' ? undefined : event.target.value === 'clear' ? null : 1)}><option value="inherit">沿用上级规则</option><option value="clear">不限制</option><option value="value">指定</option></select><Input aria-label="句子长度" type="number" min="1" disabled={typeof policy.draft.sentenceLength !== 'number'} value={typeof policy.draft.sentenceLength === 'number' ? policy.draft.sentenceLength : ''} onChange={event => policyField('sentenceLength', event.target.value ? Number(event.target.value) : undefined)} /></label><label>段落长度<select aria-label="段落长度设置" value={policy.draft.paragraphLength === undefined ? 'inherit' : policy.draft.paragraphLength === null ? 'clear' : 'value'} onChange={event => policyField('paragraphLength', event.target.value === 'inherit' ? undefined : event.target.value === 'clear' ? null : 1)}><option value="inherit">沿用上级规则</option><option value="clear">不限制</option><option value="value">指定</option></select><Input aria-label="段落长度" type="number" min="1" disabled={typeof policy.draft.paragraphLength !== 'number'} value={typeof policy.draft.paragraphLength === 'number' ? policy.draft.paragraphLength : ''} onChange={event => policyField('paragraphLength', event.target.value ? Number(event.target.value) : undefined)} /></label></div><div className="writing-check-options"><label>检查未使用术语<select aria-label="检查未使用术语" value={policy.draft.unusedConcepts === undefined ? 'inherit' : String(policy.draft.unusedConcepts)} onChange={event => policyField('unusedConcepts', event.target.value === 'inherit' ? undefined : event.target.value === 'true')}><option value="inherit">沿用上级规则</option><option value="true">检查</option><option value="false">不检查</option></select></label></div>
        <PanelHeader title="禁用表达" actions={<Button variant="outline" onClick={() => policy.edit({ ...policy.draft!, bannedTerms: [...policy.draft!.bannedTerms, { term: '', use: '', why: '' }] })}>新增规则</Button>} /><Input aria-label="搜索禁用表达" value={banQuery} onChange={event => setBanQuery(event.target.value)} placeholder="搜索写法、替换建议或理由" />
        <RecordList className="writing-rules">{shownBans.map(({ ban, index }) => <RecordItem key={index} className="writing-rule"><fieldset className="writing-fields">
          <legend className="sr-only">规则 {index + 1}</legend>
          <div className="writing-rule-main">
            <label>禁用写法<Input aria-label={`禁用写法 ${index + 1}`} value={ban.term} onChange={event => banField(index, 'term', event.target.value)} /></label>
            <label>替换建议<Textarea rows={1} aria-label={`替换建议 ${index + 1}`} value={ban.use} onChange={event => banField(index, 'use', event.target.value)} /></label>
            <label>理由<Textarea rows={1} aria-label={`理由 ${index + 1}`} value={ban.why} onChange={event => banField(index, 'why', event.target.value)} /></label>
            <Button className="writing-rule-delete" variant="ghost" size="icon" aria-label={`删除规则 ${index + 1}`} title={`删除规则 ${index + 1}`} onClick={() => policy.edit({ ...policy.draft!, bannedTerms: policy.draft!.bannedTerms.filter((_, at) => at !== index) })}><Trash2 size={16} /></Button>
          </div>
          <details className="writing-rule-scope"><summary>范围与例外<span>{ban.roots?.length ? `${ban.roots.length} 个目录` : '当前范围'}{ban.exempt?.length ? ` · ${ban.exempt.length} 个豁免` : ''}{ban.allowIn?.length ? ` · ${ban.allowIn.length} 个允许长词` : ''}</span></summary>
            <div className="writing-options">
              <label>适用范围（每行一项）<Textarea aria-label={`适用范围 ${index + 1}`} value={listed(ban.roots)} onChange={event => { const values = lines(event.target.value); banField(index, 'roots', values.length ? values : undefined); }} /></label>
              <label>豁免路径（每行一项）<Textarea aria-label={`豁免路径 ${index + 1}`} value={listed(ban.exempt)} onChange={event => banField(index, 'exempt', lines(event.target.value))} /></label>
              <label>允许的长词（每行一项）<Textarea aria-label={`允许的长词 ${index + 1}`} value={listed(ban.allowIn)} onChange={event => banField(index, 'allowIn', lines(event.target.value))} /></label>
            </div>
          </details>
        </fieldset></RecordItem>)}</RecordList><p role="status">{policy.dirty ? '写作规则有未保存草稿；检查只读取磁盘上已保存的写作规则。' : '写作规则已保存。'}</p></>}
    </section>
    <section hidden={view !== 'lint'} aria-label="按需检查" className="content-section"><PanelHeader title="按需检查" actions={<Button variant="outline" disabled={checking || !scopes.some(item => item.hasPolicy || item.hasCatalog)} onClick={() => void check()}>{checking ? '正在检查…' : '检查已保存文档'}</Button>} /><p>检查项目中已保存的文档，不包含未保存的修改。</p>{checkError && <p role="alert" className="form-error">{checkError}</p>}{report && <div><p role="status">某次快照的检查结果：{report.findings.length} 项命中，{report.files} 个文件。</p><RecordDetails title="检查详情">模式：{'mode' in report ? String(report.mode) : 'project'}；扫描目录：{'selectedRoots' in report ? String(report.selectedRoots) : '由项目来源选择'}。输入摘要：<code>{report.inputDigest}</code></RecordDetails><RecordList>{report.findings.map((item, index) => <RecordItem key={index}><strong>{item.file}:{item.line}</strong> [{item.rule}] {item.message}{item.source && <small> 来源：{item.source.path}{item.source.line ? `:${item.source.line}` : item.source.entry ? ` 第 ${item.source.entry} 项` : ''}</small>}<blockquote>{item.context}</blockquote></RecordItem>)}</RecordList></div>}</section>
    </div>
  </div>;
}
