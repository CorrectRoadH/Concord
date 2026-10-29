import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { Schema } from 'effect';
import { io, PerfError } from './process.js';
export interface BudgetRow { readonly scenarios: readonly string[]; readonly limitMs: number }
export interface OwnedBudget extends BudgetRow { readonly owner: string; readonly heading: string; readonly featureId: string; readonly limitKind: 'p50' | 'max' }
const Budget = Schema.Struct({ scenarios: Schema.Array(Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/u))).check(Schema.isMinLength(1)), limitMs: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)) });
function headings(markdown: string) {
  return fromMarkdown(markdown).children.filter(node => node.type === 'heading');
}
function headingText(heading: ReturnType<typeof headings>[number]): string {
  return heading.children.map(node => 'value' in node ? node.value : '').join('');
}
export function parseBudgetTable(markdown: string, heading: string): BudgetRow[] {
  const lines = markdown.split('\n'), tree = fromMarkdown(markdown);
  const found = headings(markdown).filter(node => node.depth === 2 && headingText(node) === heading);
  if (found.length !== 1) throw new PerfError({ message: `Expected exactly one budget heading: ${heading}` });
  const start = found[0]!.position!.end.line;
  const end = headings(markdown).find(node => node.position!.start.line > start)?.position!.start.line ?? lines.length + 1;
  const codeRanges = tree.children.filter(node => node.type === 'code').map(node => [node.position!.start.line, node.position!.end.line] as const);
  const rows: BudgetRow[] = []; let inTable = false;
  for (let index = start; index < end - 1; index++) {
    if (codeRanges.some(([first, last]) => first <= index + 1 && index + 1 <= last)) continue;
    const line = lines[index]!;
    if (!line.trim().startsWith('|')) { if (inTable) break; continue; }
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    if (!inTable) { inTable = true; continue; }
    if (cells.every(cell => /^:?-+:?$/u.test(cell))) continue;
    const scenarios = [...(cells[0] ?? '').matchAll(/`([^`]+)`/gu)].map(match => match[1]!);
    const limit = /^(\d+)ms$/u.exec(cells.at(-1) ?? '');
    if (!limit) throw new PerfError({ message: `Invalid budget limit: ${line}` });
    rows.push(Schema.decodeUnknownSync(Budget, { onExcessProperty: 'error' })({ scenarios, limitMs: Number(limit[1]) }));
  }
  if (rows.length === 0) throw new PerfError({ message: `Budget table under ${heading} has no rows` });
  return rows;
}
export const loadBudgets = (root: string) => io('Scan feature budget owners', () => {
  const rows: OwnedBudget[] = [];
  const visit = (folder: string): void => {
    for (const entry of readdirSync(join(root, folder), { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      const path = `${folder}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.mdx?$/u.test(entry.name)) {
        const text = readFileSync(join(root, path), 'utf8');
        for (const heading of ['性能预算', '刷新上限']) if (headings(text).some(node => node.depth === 2 && headingText(node) === heading)) {
          const featureId = path.split('/')[2]!;
          for (const row of parseBudgetTable(text, heading)) rows.push({ ...row, owner: path, heading, featureId, limitKind: heading === '刷新上限' ? 'max' : 'p50' });
        }
      }
    }
  };
  visit('docs/feature'); return rows;
});
export function missingOwner(args: readonly string[], exists: (path: string) => boolean): string | undefined {
  for (const arg of args) if (arg.startsWith('docs/') && !exists(arg)) return `Missing owner: ${arg}`;
  const query = args.filter(arg => !arg.startsWith('--'));
  if ((query[0] === 'trace' && query[1] === 'show') || (query[0] === 'review' && query[1] === 'render')) {
    const ref = query[2];
    if (ref && !ref.startsWith('docs/')) { const path = `docs/feature/${ref}/README.md`; if (!exists(path)) return `Missing owner: ${path}`; }
  }
  return undefined;
}
