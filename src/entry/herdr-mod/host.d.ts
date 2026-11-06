// Minimal used surface checked against herdr-app cfcf836404f932817f10f88455c33e33c94fd1df:
// defaults/AGENTS.md, defaults/herdr.d.ts and vendored gpui-kit typings.rs.
// Used calls also checked on installed 0.1.13; exec.timeout is upstream-only and unused.
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
  export function exec(command: string, args?: string[], options?: { cwd?: string; on?: string | null; timeout?: number }): Promise<{ code: number; stdout: string; stderr: string }>;
  export function readTextFile(path: string, options?: { on?: string | null }): Promise<string | null>;
  export function writeTextFile(path: string, text: string, expected: string | null): Promise<null>;
  /** Absolute paths; a root invalidation means refresh everything. May reject watch budgets. */
  export function watchFolder(path: string): Promise<string[]>;
  export function pickFolder(options?: { prompt?: string }): Promise<string | null>;
  export function focused(): { space: string; tab: string; cwd: string | null; pane: string | null; terminal: string | null; shown: string | null; agent: string | null } | null;
  export function panes(): { pane: string; mod?: string; cwd: string | null; focused: boolean; tab: string }[];
  export function spaces(): { id: string; folder: string; active: boolean; machine: string | null }[];
  export function run(name: string, args?: Record<string, unknown>): null;
  export function closeOverlay(id: string): null;
  export function appHome(): string;
  export function props(): Readonly<Record<string, unknown>>;
  export function theme(): Record<string, string>;
}
