import measure from 'string-width';

// These printable scalars have fixed widths in the pinned terminal library.
// Combining marks, variation selectors and all other graphemes use its full
// segmenter. Avoid compiling the emoji matcher for ordinary navigation text.
const fixed = /^[\u0020-\u007e\u4e00-\u9fff\u3000-\u3029\u302e-\u303e\uff01-\uff60·›●…]*$/u;
export function stringWidth(value: string): number {
  if (!fixed.test(value)) return measure(value);
  let width = 0;
  for (const character of value) {
    const point = character.charCodeAt(0);
    width += point >= 0x4e00 && point <= 0x9fff || point >= 0x3000 && point <= 0x303e || point >= 0xff01 && point <= 0xff60 ? 2 : 1;
  }
  return width;
}
