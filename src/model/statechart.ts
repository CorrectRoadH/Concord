// @concord-file
// @concord-implements docs/feature/local-sdlc/format.md#状态图块
import { createHash } from 'node:crypto';
import { Schema } from 'effect';
import { validPackagePath } from './document-layout.ts';
import { pageSource } from './herdr-mod/index.ts';
import { Sha256, type Finding } from './shared.ts';

export const StatechartRequest = Schema.Struct({ document: Schema.String, code: Schema.String, meta: Schema.String });
const StatechartOptions = Schema.Struct({
  spec: Schema.String.check(Schema.isPattern(/\.tla$/u)),
  config: Schema.String.check(Schema.isPattern(/\.cfg$/u)),
  view: Schema.optional(Schema.String.check(Schema.isPattern(/\.(?:ts|js|mjs)$/u))),
  out: Schema.String.check(Schema.isMinLength(1)),
  digest: Sha256,
});
export type StatechartOptions = typeof StatechartOptions.Type;
export const statechartPaths = ['spec', 'config', 'view', 'out'] as const;
export type StatechartPath = typeof statechartPaths[number];

export const StatechartFiles = Schema.Struct({
  spec: Schema.String, config: Schema.String, view: Schema.optional(Schema.String), out: Schema.String,
});
export type StatechartFiles = typeof StatechartFiles.Type;
export const StatechartText = Schema.Union([Schema.Struct({ text: Schema.String }), Schema.Struct({ error: Schema.String })]);
export type StatechartText = typeof StatechartText.Type;
const StatechartFinding = Schema.Struct({
  code: Schema.String, path: Schema.String, line: Schema.Int, message: Schema.String, details: Schema.optional(Schema.Json),
});
const ResolvedStatechart = Schema.Struct({
  ...StatechartFiles.fields, stale: Schema.Boolean, chart: Schema.optional(StatechartText), report: StatechartText,
});
export const StatechartResolution = Schema.Union([Schema.Struct({ error: StatechartFinding }), ResolvedStatechart]);
export type StatechartResolution = typeof StatechartResolution.Type;

export interface StatechartBlock {
  readonly document: string;
  readonly line: number;
  readonly code: string;
  readonly meta: string;
}

export function statechartOwner(path: string): string | undefined {
  const [docs, kind, name, page, ...nested] = path.split('/');
  if (docs !== 'docs' || name === undefined || (kind !== 'feature' && kind !== 'engineering' && kind !== 'roadmap')) return undefined;
  if (page === 'statechart.md' ? nested.length !== 0 : page !== 'statechart' || !nested.at(-1)?.endsWith('.md') || ['concepts.md', 'writing.md'].includes(nested.at(-1)!)) return undefined;
  const owner = `docs/${kind}/${name}/README.md`;
  return validPackagePath(kind, owner) ? owner : undefined;
}

export function statechartBlocks(document: string, source: string): readonly StatechartBlock[] {
  // CommonMark character references can spell a language name.
  if (!/(?:`{3,}|~{3,})[ \t]*(?:statechart\b|[^ \t\r\n]*&)/u.test(source)) return [];
  return pageSource(source).special.flatMap(({ node }) => node.type === 'code' && node.lang === 'statechart'
    ? [{ document, line: node.position?.start.line ?? 1, code: node.value, meta: node.meta ?? '' }]
    : []);
}

export function parseStatechart(block: StatechartBlock): { readonly options: StatechartOptions } | { readonly error: typeof StatechartFinding.Type } {
  const invalid = (attribute: string) => ({ error: {
    code: 'InvalidStatechartBlock', path: block.document, line: block.line,
    message: `Invalid statechart block: ${attribute}`, details: { attribute },
  } });
  if (block.code !== '') return invalid('body');
  const values = new Map<string, string>();
  let rest = block.meta.trim();
  while (rest) {
    const attribute = /^[^=\s"]+/u.exec(rest)?.[0] ?? 'info';
    const match = /^([^=\s"]+)="([^"\r\n]+)"(?:\s+|$)/u.exec(rest);
    if (!match || !Object.hasOwn(StatechartOptions.fields, attribute) || values.has(attribute)) return invalid(attribute);
    values.set(attribute, match[2]!);
    rest = rest.slice(match[0].length);
  }
  const parsed = Schema.decodeUnknownResult(StatechartOptions, { onExcessProperty: 'error' })(Object.fromEntries(values));
  if (parsed._tag === 'Success') return { options: parsed.success };
  for (const attribute of [...statechartPaths, 'digest'] as const) {
    const value = values.get(attribute);
    if (attribute === 'view' && value === undefined) continue;
    if (Schema.decodeUnknownResult(Schema.Struct({ [attribute]: StatechartOptions.fields[attribute] }))({ [attribute]: value })._tag === 'Failure') return invalid(attribute);
  }
  return invalid('info');
}

export function statechartDigest(files: ReadonlyMap<string, Uint8Array>): string {
  const hash = createHash('sha256');
  // JavaScript sorts UTF-16 code units; encode each path once to compare the contract's bytes.
  const encoder = new TextEncoder();
  const entries = [...files].map(([path, bytes]) => ({ path: encoder.encode(path), bytes }));
  entries.sort((left, right) => {
    const length = Math.min(left.path.length, right.path.length);
    for (let index = 0; index < length; index++) {
      const order = left.path[index]! - right.path[index]!;
      if (order) return order;
    }
    return left.path.length - right.path.length;
  });
  for (const { path, bytes } of entries) hash.update(path).update(`\0${bytes.byteLength}\0`).update(bytes);
  return `sha256:${hash.digest('hex')}`;
}

export function statechartFinding(block: StatechartBlock, code: string, message: string, details?: Finding['details']): typeof StatechartFinding.Type {
  return { code, path: block.document, line: block.line, message, ...(details === undefined ? {} : { details }) };
}
