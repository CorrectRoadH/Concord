// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/manage-writing.md
// @concord-implements docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { ViewAction } from '../../src/view-contract';
import type { BannedTerm, WritingPolicy } from '../../src/writing-policy';
import type { ConceptCatalog, ConceptDefinition } from '../../src/concepts-schema';
import type { checkWriting } from '../../src/writing';
import { useWorkspace } from '../workspace';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { PageHeader } from '../components/page';
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
  const [scope, setScope] = useState('docs');
  const [scopeInput, setScopeInput] = useState('');
  const [pendingScope, setPendingScope] = useState<string | null>(null);
  const [scopes, setScopes] = useState<readonly Scope[]>([]);
  const [aggregate, setAggregate] = useState<Aggregate | null>(null);
  const aggregateCurrent = useRef<Aggregate | null>(null);
  aggregateCurrent.current = aggregate;
  const [aggregateError, setAggregateError] = useState('');
  const [sourceWarning, setSourceWarning] = useState('');
  const [aggregateQuery, setAggregateQuery] = useState('');
  const [aggregateScope, setAggregateScope] = useState('');
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
        setSourceWarning('概念来源已变化；旧检查结果只代表先前输入快照。请审阅来源并重新检查。');
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
  const draftOwner = useMemo(() => ({
    isDirty: () => latest.current.dirty,
    flush: async () => {
      await Promise.allSettled([latest.current.policy.inFlight.current, latest.current.catalog.inFlight.current].filter((item): item is Promise<void> => item !== null));
      if (latest.current.dirty) throw new Error('写作政策或概念目录尚未显式保存。');
    },
    discard: async () => { latest.current.policy.discard(); latest.current.catalog.discard(); reportGeneration.current++; setReport(null); setCheckError(''); setChecking(false); },
  }), []);
  useLayoutEffect(() => registerAutoSave(draftOwner), [draftOwner, registerAutoSave]);
  useLayoutEffect(() => reportDirty(draftOwner), [dirty, draftOwner, reportDirty]);
  const switchScope = (next: string) => {
    if (!next || next === scope) return;
    if (latest.current.dirty) { setPendingScope(next); return; }
    policy.invalidate(); catalog.invalidate(); aggregateGeneration.current++; clearReport();
    setSourceWarning(''); setAggregateError(''); setScope(next); setBanQuery('');
  };
  const discardAndSwitch = () => {
    const next = pendingScope;
    setPendingScope(null);
    if (!next) return;
    policy.discard();
    catalog.discard();
    switchScope(next);
  };
  const reload = () => { if (latest.current.dirty) return; clearReport(); void policy.load(); void catalog.load(); void loadIndex(); void loadAggregate(); };
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
  const shownConcepts = aggregate?.concepts.filter(item => (!aggregateScope || item.scope === aggregateScope) && `${item.reference} ${item.concept.definition} ${Object.values(item.concept.names).flatMap(name => [name.preferred, ...(name.aliases ?? []), ...(name.deprecated ?? [])]).join(' ')}`.toLocaleLowerCase().includes(aggregateQuery.toLocaleLowerCase())) ?? [];
  const inherited = aggregate?.concepts.filter(item => item.path !== catalogPath(scope) && (scope === item.scope || scope.startsWith(`${item.scope}/`) || (catalog.draft?.imports ?? []).includes(item.reference))) ?? [];
  return <div className="writing-page">
    <PageHeader title="写作与术语" description="政策与概念由 docs 内各目录分别拥有；检查结果只代表一次已保存输入快照。" actions={<Button variant="outline" disabled={dirty || policy.saving || catalog.saving} onClick={reload}>重新载入</Button>} />
    <ContentSection aria-label="目录范围" title="目录范围" summary={<>当前：<code>{scope}</code></>}>
      <div className="writing-scope-toolbar">
        <label>已发现范围<select aria-label="已发现范围" value={scopes.some(item => item.scope === scope) ? scope : ''} onChange={event => switchScope(event.target.value)}><option value="" disabled>当前目录尚无 owner</option>{scopes.map(item => <option key={item.scope} value={item.scope}>{item.scope}{item.hasPolicy ? ' · 政策' : ''}{item.hasCatalog ? ' · 概念' : ''}</option>)}</select></label>
        <label>打开新目录范围（docs 下目录）<Input aria-label="新目录范围" value={scopeInput} onChange={event => setScopeInput(event.target.value)} placeholder="docs/feature/example" /></label>
        <Button variant="outline" disabled={!scopeInput.trim()} onClick={() => switchScope(scopeInput.trim())}>打开范围</Button>
      </div>
      <p className="field__hint">打开目录不会写入文件；政策与概念分别初始化、保存。</p>
    </ContentSection>
    {pendingScope && <Surface role="dialog" aria-label="切换范围并丢弃未保存内容？" className="writing-switch-dialog p-4"><strong>切换范围并丢弃未保存内容？</strong><p>当前政策或概念目录仍有草稿。</p><div className="button-row"><Button variant="outline" onClick={() => setPendingScope(null)}>留在当前范围</Button><Button variant="destructive" onClick={discardAndSwitch}>丢弃并切换</Button></div></Surface>}
    {sourceWarning && <p role="alert" className="form-error">{sourceWarning}</p>}
    <section aria-label="写作政策编辑" className="content-section"><PanelHeader title="写作政策" actions={policy.draft && <Button variant="outline" disabled={!policy.dirty || policy.saving} onClick={() => void policy.save().then(() => { void loadIndex(); void loadAggregate(); })}>{policy.saving ? '正在保存…' : '显式保存政策'}</Button>} /><div className="path-text">{policy.path}</div>
      {policy.loading && !policy.remote && <p role="status">正在载入政策…</p>}{policy.error && <p role="alert" className="form-error">{policy.error}</p>}
      {policy.remote?.state === 'missing' && !policy.open && <PanelEmpty title="尚未采用写作政策"><Button variant="outline" onClick={() => policy.initialize(emptyPolicy())}>显式初始化政策</Button></PanelEmpty>}
      {policy.remote?.state === 'invalid' && <div><h3>政策格式错误或需要迁移</h3><p role="alert">{policy.remote.diagnostic}</p><p>原文摘要：<code>{policy.remote.digest}</code></p><pre>{policy.remote.source}</pre>{!policy.open && <Button variant="outline" onClick={() => policy.initialize(emptyPolicy())}>显式修复政策</Button>}</div>}
      {policy.draft && policy.open && <><p>扫描目录留空时使用当前范围；局部政策不会自动填入全局 docs。</p><label>扫描目录（每行一项）<Textarea aria-label="扫描目录" value={listed(policy.draft.roots)} onChange={event => { const values = lines(event.target.value); policyField('roots', values.length ? values as [string, ...string[]] : undefined); }} /></label>
        <div className="writing-options"><label>句子长度<select aria-label="句子长度继承方式" value={policy.draft.sentenceLength === undefined ? 'inherit' : policy.draft.sentenceLength === null ? 'clear' : 'value'} onChange={event => policyField('sentenceLength', event.target.value === 'inherit' ? undefined : event.target.value === 'clear' ? null : 1)}><option value="inherit">继承</option><option value="clear">清除</option><option value="value">指定</option></select><Input aria-label="句子长度" type="number" min="1" disabled={typeof policy.draft.sentenceLength !== 'number'} value={typeof policy.draft.sentenceLength === 'number' ? policy.draft.sentenceLength : ''} onChange={event => policyField('sentenceLength', event.target.value ? Number(event.target.value) : undefined)} /></label><label>段落长度<select aria-label="段落长度继承方式" value={policy.draft.paragraphLength === undefined ? 'inherit' : policy.draft.paragraphLength === null ? 'clear' : 'value'} onChange={event => policyField('paragraphLength', event.target.value === 'inherit' ? undefined : event.target.value === 'clear' ? null : 1)}><option value="inherit">继承</option><option value="clear">清除</option><option value="value">指定</option></select><Input aria-label="段落长度" type="number" min="1" disabled={typeof policy.draft.paragraphLength !== 'number'} value={typeof policy.draft.paragraphLength === 'number' ? policy.draft.paragraphLength : ''} onChange={event => policyField('paragraphLength', event.target.value ? Number(event.target.value) : undefined)} /></label><label>SVG 样式<select aria-label="SVG 样式继承方式" value={policy.draft.svgStyle === undefined ? 'inherit' : policy.draft.svgStyle === null ? 'clear' : 'value'} onChange={event => policyField('svgStyle', event.target.value === 'inherit' ? undefined : event.target.value === 'clear' ? null : '')}><option value="inherit">继承</option><option value="clear">清除</option><option value="value">指定</option></select><Input aria-label="SVG 样式路径" disabled={typeof policy.draft.svgStyle !== 'string'} value={typeof policy.draft.svgStyle === 'string' ? policy.draft.svgStyle : ''} onChange={event => policyField('svgStyle', event.target.value)} /></label></div><label><input type="checkbox" checked={policy.draft.unusedConcepts ?? false} onChange={event => policyField('unusedConcepts', event.target.checked)} /> 检查未使用概念</label><label><input type="checkbox" checked={policy.draft.svgTerms ?? false} onChange={event => policyField('svgTerms', event.target.checked)} /> 检查 SVG 术语</label>
        <PanelHeader title="禁用表达" actions={<Button variant="outline" onClick={() => policy.edit({ ...policy.draft!, bannedTerms: [...policy.draft!.bannedTerms, { term: '', use: '', why: '' }] })}>新增规则</Button>} /><Input aria-label="搜索禁用表达" value={banQuery} onChange={event => setBanQuery(event.target.value)} placeholder="搜索写法、替换建议或理由" />
        <RecordList>{shownBans.map(({ ban, index }) => <RecordItem key={index}><fieldset className="writing-fields"><legend>规则 {index + 1}</legend><div className="writing-options"><label>禁用写法<Input aria-label={`禁用写法 ${index + 1}`} value={ban.term} onChange={event => banField(index, 'term', event.target.value)} /></label><label>替换建议<Input aria-label={`替换建议 ${index + 1}`} value={ban.use} onChange={event => banField(index, 'use', event.target.value)} /></label><label>理由<Input aria-label={`理由 ${index + 1}`} value={ban.why} onChange={event => banField(index, 'why', event.target.value)} /></label><label>适用目录（每行一项）<Textarea aria-label={`适用目录 ${index + 1}`} value={listed(ban.roots)} onChange={event => { const values = lines(event.target.value); banField(index, 'roots', values.length ? values : undefined); }} /></label><label>豁免路径（每行一项）<Textarea aria-label={`豁免路径 ${index + 1}`} value={listed(ban.exempt)} onChange={event => banField(index, 'exempt', lines(event.target.value))} /></label><label>允许的长词（每行一项）<Textarea aria-label={`允许的长词 ${index + 1}`} value={listed(ban.allowIn)} onChange={event => banField(index, 'allowIn', lines(event.target.value))} /></label><Button variant="outline" onClick={() => policy.edit({ ...policy.draft!, bannedTerms: policy.draft!.bannedTerms.filter((_, at) => at !== index) })}>删除规则 {index + 1}</Button></div></fieldset></RecordItem>)}</RecordList><p role="status">{policy.dirty ? '政策有未保存草稿；检查只读取磁盘上已保存的政策。' : '政策已保存。'}</p></>}
    </section>
    <section aria-label="概念目录编辑" className="content-section"><PanelHeader title="本目录概念" actions={catalog.draft && <Button variant="outline" disabled={!catalog.dirty || catalog.saving} onClick={() => void catalog.save().then(() => { void loadIndex(); void loadAggregate(); })}>{catalog.saving ? '正在保存…' : '显式保存概念'}</Button>} /><div className="path-text">{catalog.path}</div>
      {catalog.loading && !catalog.remote && <p role="status">正在载入概念…</p>}{catalog.error && <p role="alert" className="form-error">{catalog.error}</p>}
      {catalog.remote?.state === 'missing' && !catalog.open && <PanelEmpty title="本目录尚无概念目录"><Button variant="outline" onClick={() => catalog.initialize(emptyCatalog())}>显式初始化概念</Button></PanelEmpty>}
      {catalog.remote?.state === 'invalid' && <div><h3>概念目录格式错误</h3><p role="alert">{catalog.remote.diagnostic}</p><p>原文摘要：<code>{catalog.remote.digest}</code></p><pre>{catalog.remote.source}</pre>{!catalog.open && <Button variant="outline" onClick={() => catalog.initialize(emptyCatalog())}>显式修复概念</Button>}</div>}
      {catalog.draft && catalog.open && <><label>显式导入引用（每行一个 path#id）<Textarea aria-label="显式导入引用" value={listed(catalog.draft.imports)} onChange={event => { const values = lines(event.target.value); catalog.edit({ ...catalog.draft!, imports: values.length ? values : undefined }); }} /></label><PanelHeader title="本目录定义" actions={<Button variant="outline" onClick={() => catalog.edit({ ...catalog.draft!, concepts: [...catalog.draft!.concepts, { id: '', definition: '', names: { en: { preferred: '' } } }] })}>新增概念</Button>} />
        <RecordList>{catalog.draft.concepts.map((concept, index) => <RecordItem key={index}><fieldset className="writing-fields"><legend>概念 {index + 1}</legend><div className="writing-options"><label>标识 ID<Input aria-label={`概念 ID ${index + 1}`} value={concept.id} onChange={event => updateConcept(index, item => ({ ...item, id: event.target.value }))} /></label><label>定义<Textarea aria-label={`概念定义 ${index + 1}`} value={concept.definition} onChange={event => updateConcept(index, item => ({ ...item, definition: event.target.value }))} /></label></div>{Object.entries(concept.names).map(([language, name]) => <ContentSection key={language} title={`语言：${language}`} summary={<Button variant="outline" onClick={() => updateConcept(index, item => { const names = { ...item.names }; delete names[language]; return { ...item, names }; })}>删除语言 {language}</Button>}><div className="writing-options"><label>首选名称<Input aria-label={`概念 ${index + 1} ${language} 首选名称`} value={name.preferred} onChange={event => updateName(index, language, item => ({ ...item, preferred: event.target.value }))} /></label><label>允许别名（每行一项）<Textarea aria-label={`概念 ${index + 1} ${language} 允许别名`} value={listed(name.aliases)} onChange={event => updateName(index, language, item => ({ ...item, aliases: lines(event.target.value) }))} /></label><label>弃用名称（每行一项）<Textarea aria-label={`概念 ${index + 1} ${language} 弃用名称`} value={listed(name.deprecated)} onChange={event => updateName(index, language, item => ({ ...item, deprecated: lines(event.target.value) }))} /></label></div></ContentSection>)}<div className="button-row"><Input className="w-40" aria-label={`概念 ${index + 1} 新语言代码`} value={newLanguages[index] ?? ''} onChange={event => setNewLanguages(previous => ({ ...previous, [index]: event.target.value }))} placeholder="zh-CN" /><Button variant="outline" disabled={!newLanguages[index]?.trim() || newLanguages[index]?.trim() in concept.names} onClick={() => { const language = newLanguages[index]!.trim(); updateConcept(index, item => ({ ...item, names: { ...item.names, [language]: { preferred: '' } } })); setNewLanguages(previous => ({ ...previous, [index]: '' })); }}>添加语言</Button><Button variant="outline" onClick={() => catalog.edit({ ...catalog.draft!, concepts: catalog.draft!.concepts.filter((_, at) => at !== index) })}>删除概念 {index + 1}</Button></div></fieldset></RecordItem>)}</RecordList><p role="status">{catalog.dirty ? '概念有未保存草稿；政策保存不会清除这份草稿。' : '概念已保存。'}</p></>}
      {inherited.length > 0 && <div><h3>继承或导入的定义（只读）</h3><ul>{inherited.map(item => <li key={item.reference}><code>{item.reference}</code>：{item.concept.definition}</li>)}</ul></div>}
    </section>
    <section aria-label="全项目概念汇总" className="content-section"><PanelHeader title="全项目概念汇总（只读）" actions={<Button variant="outline" onClick={() => void loadAggregate()}>刷新汇总</Button>} />{aggregate && <RecordDetails title="来源快照"><code>{aggregate.inputDigest}</code></RecordDetails>}{aggregateError && <p role="alert" className="form-error">{aggregateError}</p>}<div className="writing-options"><label>搜索概念<Input aria-label="搜索概念汇总" value={aggregateQuery} onChange={event => setAggregateQuery(event.target.value)} placeholder="ID、名称、定义或来源" /></label><label>来源范围<select aria-label="汇总来源范围" value={aggregateScope} onChange={event => setAggregateScope(event.target.value)}><option value="">全部范围</option>{[...new Set(aggregate?.concepts.map(item => item.scope) ?? [])].map(item => <option key={item} value={item}>{item}</option>)}</select></label></div>{aggregate && (shownConcepts.length ? <RecordList>{shownConcepts.map(item => <RecordItem key={item.reference}><strong>{item.concept.id}</strong> <code>{item.reference}</code><span className="path-text"> · {item.scope}</span><p>{item.concept.definition}</p>{Object.entries(item.concept.names).map(([language, name]) => <small className="block text-muted-foreground" key={language}>{language}: {name.preferred}{name.aliases?.length ? ` · 别名 ${name.aliases.join('、')}` : ''}{name.deprecated?.length ? ` · 弃用 ${name.deprecated.join('、')}` : ''}</small>)}</RecordItem>)}</RecordList> : <PanelEmpty title="没有符合条件的概念。" />)}{aggregate?.catalogs.some(item => item.catalog.imports?.length) && <div><h3>显式导入</h3><ul>{aggregate.catalogs.flatMap(item => (item.catalog.imports ?? []).map(reference => <li key={`${item.path}:${reference}`}><code>{item.path}</code> → <code>{reference}</code></li>))}</ul></div>}{aggregate?.diagnostics.length ? <div role="alert"><h3>来源诊断</h3><ul>{aggregate.diagnostics.map((item, index) => <li key={index}>{item.code}：{item.message}（{item.sources.join('、')}）</li>)}</ul></div> : null}</section>
    <section aria-label="按需检查" className="content-section"><PanelHeader title="按需检查" actions={<Button variant="outline" disabled={checking || !scopes.some(item => item.hasPolicy || item.hasCatalog)} onClick={() => void check()}>{checking ? '正在检查…' : '检查已保存文档'}</Button>} /><p>检查全项目已保存输入，范围由后端项目模式选择；当前编辑范围 {scope} 不限制本按钮。结果是历史快照，草稿不参与。</p>{checkError && <p role="alert" className="form-error">{checkError}</p>}{report && <div><p role="status">某次快照的检查结果：{report.findings.length} 项命中，{report.files} 个文件。模式：{'mode' in report ? String(report.mode) : 'project'}；扫描目录：{'selectedRoots' in report ? String(report.selectedRoots) : '由项目来源选择'}。输入摘要：<code>{report.inputDigest}</code></p><RecordList>{report.findings.map((item, index) => <RecordItem key={index}><strong>{item.file}:{item.line}</strong> [{item.rule}] {item.message}{item.source && <small> 来源：{item.source.path}{item.source.line ? `:${item.source.line}` : item.source.entry ? ` 第 ${item.source.entry} 项` : ''}</small>}<blockquote>{item.context}</blockquote></RecordItem>)}</RecordList></div>}</section>
  </div>;
}
