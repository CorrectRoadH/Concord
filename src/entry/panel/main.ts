import { createElement as h, useEffect, useRef, useState } from 'react';
import { render, useInput, useWindowSize, type RenderOptions } from 'ink';
import { Effect, Fiber, Schema, type Scope } from 'effect';
import type { WorkspaceDisplay } from '../../model/workspace-display/index.js';
import { documentCategories } from '../../model/workspace-display/index.js';
import { PanelView, panelDetail, type BoundPanelBody } from './view.js';
import { initialPanelState, navigatePanel, reconcilePanelState, visiblePanelItems, panelItems, type PanelState } from './state.js';
import type { PanelConcept } from './markdown.js';

export interface PanelGeneration {
  readonly model: WorkspaceDisplay;
  /** Already resolved by document directory in this generation. */
  readonly concepts: ReadonlyMap<string, readonly PanelConcept[]>;
}
export interface PanelReadResult { readonly path: string; readonly digest: string; readonly body: string }
export interface PanelPorts {
  readonly read: (request: { readonly path: string; readonly expectedDigest: string }) => Effect.Effect<PanelReadResult, Error>;
  readonly openInWeb: (path: string) => Effect.Effect<string, Error>;
}
export class PanelWorktreeUnknown extends Schema.TaggedError<PanelWorktreeUnknown>()('PanelWorktreeUnknown', { message: Schema.String }) {}
/** Herdr adapters must pass the invocation context, never the plugin cwd. */
export const panelWorktree = (context: unknown) => Schema.decodeUnknownEffect(Schema.Struct({ focused_pane_cwd: Schema.String.check(Schema.isPattern(/^\S[\s\S]*$/u)), focused_pane_id: Schema.String.check(Schema.isMinLength(1)) }), { onExcessProperty: 'ignore' })(context).pipe(
  Effect.map(value => ({ cwd: value.focused_pane_cwd, targetPaneId: value.focused_pane_id })),
  Effect.mapError(() => new PanelWorktreeUnknown({ message: 'PanelWorktreeUnknown：当前 pane 没有工作目录，无法打开 Spec 面板。' })),
);
const BodyRead = Schema.Struct({ path: Schema.String, digest: Schema.String, body: Schema.String });
interface InteractiveProps {
  readonly generation?: PanelGeneration;
  readonly ports: PanelPorts;
  readonly reconnecting: boolean;
  readonly noColor: boolean;
  readonly quit: () => void;
  readonly scope: Scope.Scope;
}
function InteractivePanel(props: InteractiveProps) {
  const { columns, rows } = useWindowSize();
  const [state, setState] = useState<PanelState>(initialPanelState);
  const [bodies, setBodies] = useState<ReadonlyMap<string, BoundPanelBody>>(new Map());
  const bodyCache = useRef(new Map<string, PanelReadResult>());
  const previous = useRef<WorkspaceDisplay | undefined>(undefined);
  const [command, setCommand] = useState('');
  const model = props.generation?.model;
  // Reconcile before rendering this generation so removed items cannot be read.
  const current = model ? reconcilePanelState(state, previous.current, model) : state;
  useEffect(() => { previous.current = model; setState(current); }, [model]);
  const selected = model && panelItems(model).find(item => item.path === current.selected);
  useEffect(() => {
    if (!selected || !selected.digest || !props.generation) return;
    const generation = props.generation, path = selected.path, sourcePath = selected.sourcePath ?? path, digest = selected.digest;
    const cacheKey = `${sourcePath}\0${digest}`;
    const cached = bodyCache.current.get(cacheKey);
    if (cached) {
      setBodies(old => new Map(old).set(path, { ...cached, path, model: generation.model, concepts: generation.concepts.get(path) ?? [] }));
      return;
    }
    const fiber = Effect.runSync(Effect.forkIn(Effect.gen(function*() {
      const response = yield* props.ports.read({ path: sourcePath, expectedDigest: digest });
      const body = yield* Schema.decodeUnknownEffect(BodyRead, { onExcessProperty: 'error' })(response);
      if (body.path !== sourcePath || body.digest !== digest) return; // Wait for the next generation; retain accepted old detail.
      yield* Effect.sync(() => {
        bodyCache.current.set(cacheKey, body);
        setBodies(old => new Map(old).set(path, { ...body, path, model: generation.model, concepts: generation.concepts.get(path) ?? [] }));
      });
    }).pipe(Effect.catch(cause => Effect.sync(() => setState(old => ({ ...old, message: String(cause) }))))), props.scope));
    return () => { Effect.runFork(Fiber.interrupt(fiber)); };
  }, [model, selected?.path, selected?.digest, props.ports]);
  const propsForView = { model, bodies, state: current, columns, rows, noColor: props.noColor, connection: props.reconnecting ? 'reconnecting' as const : model ? 'connected' as const : 'building' as const };
  const detail = panelDetail(propsForView);
  const openFiber = useRef<Fiber.Fiber<unknown, unknown> | undefined>(undefined);
  useEffect(() => () => { if (openFiber.current) Effect.runFork(Fiber.interrupt(openFiber.current)); }, []);
  useInput((input, key) => {
    if (current.filtering) {
      if (key.escape || key.return) { setState({ ...current, filtering: false }); return; }
      const filter = key.backspace || key.delete ? current.filter.slice(0, -1) : current.filter + input;
      const next = { ...current, filter };
      const items = model && visiblePanelItems(model, next);
      setState({ ...next, concept: undefined, selected: items?.some(item => item.path === current.selected) ? current.selected : items?.[0]?.path }); return;
    }
    if (input === 'q' || key.ctrl && input === 'c') { props.quit(); return; }
    if (input === '/' && current.focus === 'navigation') { setState({ ...current, filtering: true }); return; }
    if (key.tab) { setState({ ...current, focus: current.focus === 'navigation' ? 'body' : 'navigation' }); return; }
    if (key.escape) {
      setCommand('');
      const last = current.history.at(-1);
      setState(last ? { ...current, ...last, history: current.history.slice(0, -1), concept: undefined } : { ...current, concept: undefined, focus: 'navigation', category: current.focus === 'navigation' ? null : current.category }); return;
    }
    if (input === 'o' && current.selected) {
      if (openFiber.current) Effect.runFork(Fiber.interrupt(openFiber.current));
      openFiber.current = Effect.runSync(Effect.forkIn(props.ports.openInWeb(current.concept ? `${current.concept.path}#${current.concept.id}` : current.selected).pipe(
        Effect.match({ onFailure: error => setState(old => ({ ...old, message: error.message })), onSuccess: address => setState(old => ({ ...old, message: address })) }),
      ), props.scope)); return;
    }
    if (current.focus === 'body' && /^[c\d]$/u.test(input)) { setCommand(old => old + input); return; }
    if (key.return && current.focus === 'body' && command && model) {
      const number = Number(command.replace(/^c/u, '')) - 1;
      if (command.startsWith('c')) { const concept = detail.concepts[number]; if (concept) setState({ ...current, concept, history: [...current.history, { selected: current.selected, category: current.category, focus: current.focus }] }); }
      else { const link = detail.links[number]; if (link) setState(navigatePanel(current, link.target, model)); }
      setCommand(''); return;
    }
    if (key.return && current.focus === 'navigation' && model) {
      if (current.category === null) {
        const category = [...documentCategories.map(item => item.kind), 'docs'][current.categoryCursor] ?? 'feature';
        const items = visiblePanelItems(model, { ...current, category });
        setState({ ...current, category, concept: undefined, selected: items[0]?.path, filter: '' });
      } else setState({ ...current, focus: 'body' });
      return;
    }
    const delta = input === 'j' || key.downArrow || key.pageDown ? 1 : input === 'k' || key.upArrow || key.pageUp ? -1 : 0;
    if (current.focus === 'navigation' && delta) {
      if (current.category === null) setState({ ...current, categoryCursor: Math.max(0, Math.min(documentCategories.length, current.categoryCursor + delta)) });
      else if (model) {
        const items = visiblePanelItems(model, current), index = items.findIndex(item => item.path === current.selected);
        setState({ ...current, concept: undefined, selected: items[Math.max(0, Math.min(items.length - 1, index + delta))]?.path });
      }
    } else if (current.focus === 'body' && current.selected) {
      const scrollKey = current.concept ? `${current.concept.path}#${current.concept.id}` : current.selected;
      const scroll = current.scroll[scrollKey] ?? { row: 0, column: 0 };
      const row = Math.max(0, scroll.row + delta * (key.pageDown || key.pageUp ? Math.max(1, rows - 5) : 1));
      const column = Math.max(0, scroll.column + (key.rightArrow ? 4 : key.leftArrow ? -4 : 0));
      setState({ ...current, scroll: { ...current.scroll, [scrollKey]: { row, column } } });
    }
  });
  return h(PanelView, { ...propsForView, state: command ? { ...current, message: `打开：${command}` } : current });
}
export interface PanelSession {
  readonly update: (generation: PanelGeneration | undefined, reconnecting?: boolean) => Effect.Effect<void>;
  readonly closed: Effect.Effect<void, unknown>;
}
/** Rendering resource only. The composition root supplies the transport ports. */
export const renderPanel = Effect.fn('renderPanel')(function*(ports: PanelPorts, initial?: PanelGeneration, options: RenderOptions = {}) {
  const scope = yield* Effect.scope;
  let lastGeneration = initial;
  const noColor = Object.hasOwn(process.env, 'NO_COLOR');
  const instance = yield* Effect.acquireRelease(Effect.sync(() => {
    const result = render(h(InteractivePanel, { ports, generation: initial, reconnecting: false, noColor, scope, quit: () => result.unmount() }), { ...options, exitOnCtrlC: false, patchConsole: false });
    return result;
  }), instance => Effect.sync(() => instance.unmount()));
  return {
    update: (generation, reconnecting = false) => Effect.sync(() => {
      if (generation) lastGeneration = generation;
      instance.rerender(h(InteractivePanel, { ports, generation: reconnecting ? generation ?? lastGeneration : generation, reconnecting, noColor, scope, quit: () => instance.unmount() }));
    }),
    closed: Effect.tryPromise(() => instance.waitUntilExit()),
  } satisfies PanelSession;
});
