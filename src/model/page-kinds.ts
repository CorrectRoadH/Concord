// @concord-file
// @concord-implements docs/feature/documentation-quality/cli.md#页面种类
// @concord-implements docs/feature/local-sdlc/cli.md#查看一个文档包

export const SPLIT_PAGE_KINDS = ['cli', 'library', 'api', 'format', 'ui', 'architecture', 'data-model'] as const;
export const PACKAGE_PAGE_KINDS = ['README', 'use-case', ...SPLIT_PAGE_KINDS, 'performance', 'concepts', 'writing'] as const;
export type PackagePageKind = 'readme' | 'use-case-index' | 'use-case' | typeof SPLIT_PAGE_KINDS[number] | 'performance' | 'concepts' | 'writing' | 'unknown';

/** A page keeps its exact path; a kind directory never creates another owner. */
export function packagePageKind(owner: string, path: string, paths: ReadonlySet<string>): PackagePageKind {
  const root = owner.slice(0, -'README.md'.length);
  if (!path.startsWith(root)) return 'unknown';
  const relative = path.slice(root.length), parts = relative.split('/');
  if (relative === 'README.md') return 'readme';
  if (parts[0] === 'use-case') return parts.length === 2 && parts[1]!.endsWith('.md')
    ? parts[1] === 'README.md' ? 'use-case-index' : 'use-case' : 'unknown';
  if (parts.at(-1) === 'concepts.md') return 'concepts';
  if (parts.at(-1) === 'writing.md') return 'writing';
  if (relative === 'performance.md') return 'performance';
  for (const kind of SPLIT_PAGE_KINDS) {
    if (relative === `${kind}.md`) return [...paths].some(candidate => candidate.startsWith(`${root}${kind}/`)) ? 'unknown' : kind;
    if (parts[0] === kind && parts.length > 1 && relative.endsWith('.md') && paths.has(`${root}${kind}/README.md`)) return kind;
  }
  return 'unknown';
}

function distance(left: string, right: string): number {
  const rows = Array.from({ length: left.length + 1 }, (_, i) => Array.from({ length: right.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= left.length; i++) for (let j = 1; j <= right.length; j++) {
    rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) rows[i]![j] = Math.min(rows[i]![j]!, rows[i - 2]![j - 2]! + 1);
  }
  return rows[left.length]![right.length]!;
}

export function pageKindSuggestions(relative: string): readonly string[] {
  const name = relative.split('/')[0]!.replace(/\.mdx?$/u, '').toLowerCase();
  const scores = PACKAGE_PAGE_KINDS.map(kind => ({ kind, score: distance(name, kind.toLowerCase()) }));
  const best = Math.min(...scores.map(item => item.score));
  return best <= (name.length > 4 ? 2 : 1) ? scores.filter(item => item.score === best).map(item => item.kind) : PACKAGE_PAGE_KINDS;
}
