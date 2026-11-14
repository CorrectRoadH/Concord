// Minimal used surface checked against the installed herdr-app host declarations.
// Source compatibility is distinct from herdr-app check and native drawing acceptance.
// No Node APIs or browser/DOM APIs exist in the mod runtime.
declare module 'gpui-kit' {
  import type { VirtualListScrollHandle } from 'gpui-base';
  export interface Task { cancel(): void; is_done(): boolean }
  export interface FocusHandle { focus(): void; is_focused(): boolean; release(): boolean }
  export interface MouseButtonEvent { position: { x: number; y: number }; local_position?: { x: number; y: number } }
  export interface Context {
    focus_handle(): FocusHandle;
    notify(): void;
    stop_propagation(): void;
    open_url(url: string): void;
    write_to_clipboard(text: string): void;
    sleep(ms?: number): Promise<void>;
    spawn(body: (cx: AsyncContext) => unknown): Task;
    timer: {
      after(ms: number, body: (cx: AsyncContext) => void): Task;
      every(ms: number, body: (cx: AsyncContext) => void): Task;
    };
  }
  /** Only task, timer and lifecycle contexts remain valid across await. */
  export interface AsyncContext extends Context {}
  export interface Element {
    id(value: string): this;
    child(value: Element | string): this;
    children(value: readonly (Element | string)[]): this;
    size_full(): this; flex_1(): this; min_w(value: number): this; min_h(value: number): this;
    size(value: number): this; flex_none(): this;
    w(value: number): this; h(value: number): this; gap(value: number): this;
    max_w(value: number): this; max_h(value: number): this; items_center(): this; items_start(): this; justify_center(): this;
    max_w_full(): this;
    p(value: number): this; px(value: number): this; py(value: number): this;
    bg(value: string): this; text_color(value: string): this; text_size(value: number): this;
    rounded(value: number): this; overflow_y_scroll(): this;
    pl(value: number): this; pr(value: number): this;
    border_1(): this; border_b(value: number): this; border_r(value: number): this; border_t(value: number): this; border_color(value: string): this;
    cursor_pointer(): this; truncate(): this; font_semibold(): this; font_family(value: string): this;
    hover(body: (element: Element) => Element): this;
    on_size_change(body: (size: { width: number; height: number }, cx: Context) => void): this;
    track_scroll(handle: VirtualListScrollHandle): this;
    items_stretch(): this; overflow_hidden(): this;
    absolute(): this; relative(): this; shadow_md(): this; inset_0(): this;
    left(value: number): this; top(value: number): this;
    track_focus(handle: FocusHandle): this;
    on_key_down(body: (event: { key: string; keystroke: string }, cx: Context) => void): this;
    on_mouse_down(button: 'left' | 'right' | 'middle', body: (event: MouseButtonEvent, cx: Context) => void): this;
    on_mouse_down_out(body: (event: MouseButtonEvent, cx: Context) => void): this;
    on_click(body: (event: unknown, cx: Context) => void): this;
  }
  export abstract class View {
    init?(props: Readonly<Record<string, unknown>> | undefined, cx: AsyncContext): void;
    close?(cx: AsyncContext): void | Promise<void>;
    abstract render(cx: Context): Element | string;
  }
  export function div(): Element;
  export function image(path: string): Element;
  export function svg(path: string): Element;
}
declare module 'gpui-base' {
  import type { Context, Element } from 'gpui-kit';
  export function h_flex(): Element;
  export function v_flex(): Element;
  export function v_virtual_list(id: string, count: number, height: number, key: (index: number) => string, render: (range: { start: number; end: number }, cx: Context) => Element[]): Element;
  export const TextView: { markdown(id: string, source: string): Element & { on_link_click(body: (url: string, cx: Context) => void): Element } };
  export interface EditorState { value(): string; set_value(value: string): void; release(): boolean }
  export const EditorState: { new: (options?: { language?: string; value?: string; readonly?: boolean; font_family?: string; font_size?: number }) => EditorState };
  export const Editor: { new: (state: EditorState) => Element };
  export interface TextareaState {
    value(): string;
    set_value(value: string): void;
    set_auto_grow(min: number, max: number): void;
    focus(): void;
    on(event: 'change' | 'blur', body: (event: unknown, cx: Context) => void): boolean;
    release(): boolean;
  }
  export const TextareaState: { new: (options?: { value?: string; rows?: number }) => TextareaState };
  export const Textarea: { new: (state: TextareaState) => Element };
  export interface VirtualListScrollHandle { release(): boolean }
  export const VirtualListScrollHandle: { new: () => VirtualListScrollHandle };
}
declare module 'herdr' {
  export function exec(command: string, args?: string[], options?: { cwd?: string; on?: string | null }): Promise<{ code: number; stdout: string; stderr: string }>;
  export function focused(): { space: string; tab: string; cwd: string | null; pane: string | null; terminal: string | null; shown: string | null; agent: string | null } | null;
  export function panes(): { pane: string; terminal: string | null; mod?: string; cwd: string | null; focused: boolean; tab: string }[];
  export function spaces(): { id: string; folder: string; active: boolean; machine: string | null; tabs: { id: string; active: boolean }[] }[];
  export function run(name: string, args?: Record<string, unknown>): null;
  export function closeOverlay(id: string): null;
  export function appHome(): string;
  export function home(): string;
  export function props(): Readonly<Record<string, unknown>>;
  export function theme(): Record<string, string>;
  export function settings(): { font_family?: string };
  export function shared(key: string): unknown;
  export function setShared(key: string, value: unknown): null;
}
