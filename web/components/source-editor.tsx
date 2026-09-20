// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/use-web-workbench.md
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { useLayoutEffect, useRef } from 'react';

export function SourceEditor({ value, path, readOnly, extensions, location, onChange }: {
  readonly value: string;
  readonly path: string;
  readonly readOnly: boolean;
  readonly extensions: readonly Extension[];
  readonly location?: { readonly line: number; readonly endLine: number };
  readonly onChange: (value: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const access = useRef(new Compartment());
  const change = useRef(onChange);
  change.current = onChange;
  useLayoutEffect(() => {
    if (!container.current) return;
    const editor = new EditorView({
      parent: container.current,
      state: EditorState.create({ doc: value, extensions: [
        ...extensions, lineNumbers(), history(), drawSelection(), highlightActiveLine(), highlightActiveLineGutter(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        javascript({ typescript: /\.[cm]?tsx?$/i.test(path), jsx: /\.[jt]sx$/i.test(path) }),
        access.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
        EditorView.contentAttributes.of({ 'aria-label': '源码原文', role: 'textbox', 'aria-multiline': 'true' }),
        EditorView.theme({ '&': { height: '60vh', minHeight: '240px' }, '.cm-scroller': { overflow: 'auto' } }),
        EditorView.updateListener.of(update => { if (update.docChanged) change.current(update.state.doc.toString()); }),
      ] }),
    });
    view.current = editor;
    return () => { view.current = null; editor.destroy(); };
  }, [path, extensions]);
  useLayoutEffect(() => {
    const editor = view.current;
    if (!editor) return;
    if (editor.state.doc.toString() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    editor.dispatch({ effects: access.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
  }, [value, readOnly]);
  useLayoutEffect(() => {
    const editor = view.current;
    if (!editor || !location) return;
    const line = editor.state.doc.line(Math.max(1, Math.min(location.line, editor.state.doc.lines)));
    editor.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 24 }) });
  }, [location, path]);
  return <div ref={container} className="source-editor" />;
}
