// @concord-file
// @concord-implements docs/feature/web-workbench/use-case/embed-p5-sketch.md#主题色
import { Schema } from 'effect';
import { P5ControlSchema } from '../../src/model/p5/index.ts';

// Values travel as literals, never as CSS declarations or variable references.
const colorNames = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato transparent turquoise violet wheat white whitesmoke yellow yellowgreen').split(' '));
const numeric = String.raw`[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?`;
const channel = `${numeric}%?`;
const triple = (unit: string) => `${numeric}${unit}\\s*,\\s*${numeric}${unit}\\s*,\\s*${numeric}${unit}`;
const rgb = new RegExp(`^rgba?\\(\\s*(?:(?:${triple('')}|${triple('%')})(?:\\s*,\\s*${channel})?|${channel}\\s+${channel}\\s+${channel}(?:\\s*/\\s*${channel})?)\\s*\\)$`, 'iu');
const hsl = new RegExp(`^hsla?\\(\\s*${numeric}(?:deg|grad|rad|turn)?(?:\\s*,\\s*${numeric}%\\s*,\\s*${numeric}%(?:\\s*,\\s*${channel})?|\\s+${numeric}%\\s+${numeric}%(?:\\s*/\\s*${channel})?)\\s*\\)$`, 'iu');
function isColor(value: string): boolean {
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/iu.test(value) || colorNames.has(value.toLowerCase())) return true;
  // The portable grammar covers the literal formats used by the workbench.
  if (!rgb.test(value) && !hsl.test(value)) return false;
  const css = (globalThis as { CSS?: { supports(property: string, value: string): boolean } }).CSS;
  return css === undefined || css.supports('color', value);
}
const color = Schema.String.check(Schema.isMaxLength(256), Schema.makeFilter(isColor));
const identifier = String.raw`(?:--|-[\p{L}_]|[\p{L}_])[\p{L}\p{N}_-]*`;
const family = String.raw`(?:"[^"\\\x00-\x1f;(){}<>]+"|'[^'\\\x00-\x1f;(){}<>]+'|${identifier}(?:\s+${identifier})*)`;
const fontPattern = new RegExp(`^${family}(?:\\s*,\\s*${family})*$`, 'u');
const font = Schema.String.check(Schema.isMaxLength(2048), Schema.makeFilter(value => {
  if (!fontPattern.test(value) || /\b(?:url|expression)\s*\(/iu.test(value)) return false;
  if (value.split(',').some(name => /^(?:inherit|initial|unset|revert|revert-layer|default)$/iu.test(name.trim()))) return false;
  const css = (globalThis as { CSS?: { supports(property: string, value: string): boolean } }).CSS;
  return css === undefined || css.supports('font-family', value);
}));

export const WorkbenchThemeSchema = Schema.Struct({
  '--concord-bg': color,
  '--concord-fg': color,
  '--concord-muted': color,
  '--concord-accent': color,
  '--concord-series-1': color,
  '--concord-series-2': color,
  '--concord-series-3': color,
  '--concord-series-4': color,
  '--concord-series-5': color,
  '--concord-series-6': color,
  '--concord-series-7': color,
  '--concord-series-8': color,
  '--concord-font': font,
});
export type WorkbenchTheme = typeof WorkbenchThemeSchema.Type;
export const themeVariables = Object.keys(WorkbenchThemeSchema.fields) as (keyof WorkbenchTheme)[];
export const P5ThemeMessageSchema = Schema.Struct({ kind: Schema.Literal('theme'), variables: WorkbenchThemeSchema });
export const P5FrameControlSchema = Schema.Union([P5ControlSchema, P5ThemeMessageSchema]);
