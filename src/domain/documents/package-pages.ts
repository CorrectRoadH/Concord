// @concord-file
// @concord-implements docs/feature/documentation-quality/cli.md#页面种类
import { SPLIT_PAGE_KINDS, type Repository } from '../../model/index.js';

/** Include empty directories so a single-page conflict cannot disappear. */
export function packagePagePaths(repo: Repository, owner: string): ReadonlySet<string> {
  const root = owner.slice(0, -'/README.md'.length);
  const paths = new Set(repo.files(root));
  for (const kind of SPLIT_PAGE_KINDS) if (repo.inspect?.(`${root}/${kind}`)?.directory) paths.add(`${root}/${kind}/`);
  return paths;
}
