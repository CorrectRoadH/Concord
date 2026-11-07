// Minimal used surface checked against the installed herdr-app host declarations.
// Source compatibility is distinct from herdr-app check and native drawing acceptance.
// No Node APIs or browser/DOM APIs exist in the mod runtime.
declare module 'gpui-kit' {
  export interface Task { cancel(): void; is_done(): boolean }
  export interface Context {
    notify(): void;
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
    w(value: number): this; h(value: number): this; gap(value: number): this;
    max_w(value: number): this; items_center(): this; items_start(): this; justify_center(): this;
    p(value: number): this; px(value: number): this; py(value: number): this;
    bg(value: string): this; text_color(value: string): this; text_size(value: number): this;
    rounded(value: number): this; overflow_y_scroll(): this;
    items_stretch(): this; overflow_hidden(): this;
    on_click(body: (event: unknown, cx: Context) => void): this;
  }
  export abstract class View {
    init?(props: Readonly<Record<string, unknown>> | undefined, cx: AsyncContext): void;
    close?(cx: AsyncContext): void | Promise<void>;
    abstract render(cx: Context): Element | string;
  }
  export function div(): Element;
}
declare module 'gpui-base' {
  import type { Context, Element } from 'gpui-kit';
  export function h_flex(): Element;
  export function v_flex(): Element;
  export const TextView: { markdown(id: string, source: string): Element & { on_link_click(body: (url: string, cx: Context) => void): Element } };
  export interface EditorState { value(): string; set_value(value: string): void; release(): boolean }
  export const EditorState: { new: (options?: { language?: string; value?: string; readonly?: boolean }) => EditorState };
  export const Editor: { new: (state: EditorState) => Element };
  export interface InputState { value(): string; release(): boolean }
  export const InputState: { new: (options?: { placeholder?: string; value?: string }) => InputState };
  export const Input: { new: (state: InputState) => Element };
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
}
