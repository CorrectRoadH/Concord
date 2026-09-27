// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/embed-p5-sketch.md
import { Schema } from 'effect';

export const P5RequestSchema = Schema.Struct({
  document: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
  code: Schema.String.check(Schema.isMaxLength(256 * 1024)),
  meta: Schema.String.check(Schema.isMaxLength(4096)),
});
export type P5Request = typeof P5RequestSchema.Type;
export const P5OptionsSchema = Schema.Struct({
  src: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  css: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  mode: Schema.optional(Schema.Literals(['instance', 'global'])),
});
export const P5_LIBRARIES = {
  'p5.sound': { version: '0.4.1', file: 'p5.sound.js', source: 'node_modules/p5.sound/dist/p5.sound.js', license: 'node_modules/p5.sound/LICENSE' },
  'p5.brush': { version: '2.2.3', file: 'p5.brush.js', source: 'node_modules/p5.brush/dist/p5.brush.js', license: 'node_modules/p5.brush/LICENSE.md' },
} as const;
export function parseP5Options(meta: string): typeof P5OptionsSchema.Type {
  const values: Record<string, string> = {};
  let rest = meta.trim();
  while (rest) {
    const match = /^(src|css|mode)="([^"\r\n]+)"(?:\s+|$)/u.exec(rest);
    if (!match || Object.hasOwn(values, match[1]!)) throw new Error('p5 metadata accepts unique src="…", css="…", mode="instance|global" attributes; libraries belong in project configuration');
    values[match[1]!] = match[2]!;
    rest = rest.slice(match[0].length);
  }
  return Schema.decodeUnknownSync(P5OptionsSchema, { onExcessProperty: 'error' })(values);
}

export const P5BundleSchema = Schema.Struct({
  javascript: Schema.String.check(Schema.isMaxLength(16 * 1024 * 1024)),
  css: Schema.String.check(Schema.isMaxLength(16 * 1024 * 1024)),
  mode: Schema.Literals(['instance', 'global']),
  files: Schema.Array(Schema.String),
  libraries: Schema.Array(Schema.Struct({ name: Schema.String, source: Schema.String.check(Schema.isMaxLength(8 * 1024 * 1024)) })).check(Schema.isMaxLength(16)),
});
export type P5Bundle = typeof P5BundleSchema.Type;
export const P5ControlSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('start'), bundle: P5BundleSchema }),
  Schema.Struct({ kind: Schema.Literals(['pause', 'resume']) }),
]);
export const P5EventSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(['ready', 'started']) }),
  Schema.Struct({ kind: Schema.Literal('error'), message: Schema.String.check(Schema.isMaxLength(4096)) }),
  Schema.Struct({ kind: Schema.Literal('resize'), height: Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 2000 })) }),
]);
