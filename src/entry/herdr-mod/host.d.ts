// Minimal used surface from herdr-app 0c1a10269b1f8bb0c8e6c18aec4c084757104c39:
// defaults/AGENTS.md, defaults/herdr.d.ts and vendored gpui-kit typings.rs.
// 未经真实主机核对。No Node APIs or browser/DOM APIs exist in the mod runtime.
declare module 'gpui-kit' {
  export interface Task { cancel(): void; is_done(): boolean }
  export interface Context {
    notify(): void;
    spawn(body: (cx: Context) => unknown): Task;
    timer: { after(ms: number, body: (cx: Context) => void): Task };
  }
  export interface Element {
    id(value: string): this;
    child(value: Element | string): this;
    children(value: readonly (Element | string)[]): this;
    size_full(): this; flex_1(): this; min_w(value: number): this; min_h(value: number): this;
    w(value: number): this; h(value: number): this; gap(value: number): this;
    p(value: number): this; px(value: number): this; py(value: number): this;
    bg(value: string): this; text_color(value: string): this; text_size(value: number): this;
    rounded(value: number): this; overflow_y_scroll(): this;
    on_click(body: (event: unknown, cx: Context) => void): this;
  }
  export abstract class View {
    init?(props: Readonly<Record<string, unknown>> | undefined, cx: Context): void;
    close?(cx: Context): void | Promise<void>;
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
  export const EditorState: { new: (options: { language: string; value: string; readonly?: boolean }) => EditorState };
  export const Editor: { new: (state: EditorState) => Element };
  export interface InputState { value(): string; release(): boolean }
  export const InputState: { new: (options: { placeholder: string }) => InputState };
  export const Input: { new: (state: InputState) => Element };
}
declare module 'herdr' {
  export function exec(command: string, args: string[], options: { cwd: string }): Promise<{ code: number; stdout: string; stderr: string }>;
  export function readTextFile(path: string): Promise<string | null>;
  export function writeTextFile(path: string, text: string, expected: string | null): Promise<null>;
  export function watchFolder(path: string): Promise<string[]>;
  export function pickFolder(options: { prompt: string }): Promise<string | null>;
  export function focused(): { cwd: string | null; pane: string | null } | null;
  export function theme(): Record<string, string>;
}
