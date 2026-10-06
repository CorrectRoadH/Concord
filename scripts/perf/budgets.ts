/**
 * Budgets are read from the owning contracts instead of a second registry.
 * A budget table is the first Markdown table after the named heading; each row lists
 * full commands as `concord ...` code spans and ends with a `<n>ms` cell.
 */
export interface BudgetRow { readonly commands: readonly (readonly string[])[]; readonly limitMs: number }

export const budgetSources = {
  cli: { path: 'docs/feature/local-sdlc/README.md', heading: '性能预算' },
  query: { path: 'docs/feature/local-data-engine/use-case/query-asynchronous-projections.md', heading: '性能预算' },
  refresh: { path: 'docs/feature/local-data-engine/use-case/query-asynchronous-projections.md', heading: '刷新上限' },
} as const;

/** Return the first absent command owner; existence is supplied by the frozen consumer. */
export function missingOwner(args: readonly string[], exists: (relativePath: string) => boolean): string | undefined {
  for (const arg of args) if (arg.startsWith('docs/') && !exists(arg)) return `Missing owner: ${arg}`;
  const query = args.filter(arg => !arg.startsWith('--'));
  if ((query[0] === 'trace' && query[1] === 'show') || (query[0] === 'review' && query[1] === 'render')) {
    const ref = query[2];
    if (ref !== undefined && !ref.startsWith('docs/')) {
      const path = `docs/feature/${ref}/README.md`;
      if (!exists(path)) return `Missing owner: ${path}`;
    }
  }
  return undefined;
}

export function parseBudgetTable(markdown: string, heading: string): BudgetRow[] {
  const lines = markdown.split('\n');
  const start = lines.findIndex(line => /^#{2,6}\s/u.test(line) && line.replace(/^#+\s*/u, '').trim() === heading);
  if (start < 0) throw new Error(`Budget heading not found: ${heading}`);
  const rows: BudgetRow[] = [];
  let inTable = false;
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/u.test(line)) break;
    if (!line.trim().startsWith('|')) { if (inTable) break; continue; }
    inTable = true;
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    const commands = [...(cells[0] ?? '').matchAll(/`(concord(?: [^`]+)?)`/gu)].map(match => match[1]!.trim().split(/\s+/u).slice(1));
    if (commands.length === 0) continue;
    const limit = /^(\d+)ms$/u.exec(cells.at(-1) ?? '');
    if (!limit || !Number.isSafeInteger(Number(limit[1]))) throw new Error(`Invalid budget limit: ${line}`);
    rows.push({ commands, limitMs: Number(limit[1]) });
  }
  if (rows.length === 0) throw new Error(`Budget table under ${heading} has no rows`);
  return rows;
}
