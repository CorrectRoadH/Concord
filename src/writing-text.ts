// @concord-file
// @concord-implements docs/feature/documentation-quality/use-case/manage-scoped-terminology.md
export interface SvgText {
  line: number;
  classes: string[];
  text: string;
}

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** Preserve tspan text in the parent label and include accessible title/desc text. */
export function svgTexts(svg: string): SvgText[] {
  const texts: SvgText[] = [];
  for (const match of svg.matchAll(/<(text|title|desc)\b([^>]*)>([\s\S]*?)<\/\1>/gu)) {
    const tag = match[1], attributes = match[2], inner = match[3];
    if (tag === undefined || attributes === undefined || inner === undefined) continue;
    const classes = (/class="([^"]*)"/u.exec(attributes)?.[1] ?? '').split(/\s+/u).filter(Boolean);
    const text = inner
      .replace(/<tspan\b(?![^>]*\s(?:x|y|dx|dy)=)[^>]*>|<\/tspan>/gu, '')
      .replace(/<[^>]*>/gu, ' ')
      .replace(/&(?:amp|lt|gt|quot|#39);/gu, entity => XML_ENTITIES[entity] ?? entity)
      .replace(/\s+/gu, ' ')
      .trim();
    texts.push({ line: svg.slice(0, match.index).split('\n').length, classes: tag === 'text' ? classes : [tag], text });
  }
  return texts;
}
