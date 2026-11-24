// @concord-file
// @concord-implements docs/feature/documentation-quality/cli.md#页面种类
import { splitPageKinds, type Repository } from '../../model/index.ts';
import { outsideStatechartOutputs, statechartOutputRoots } from './statechart.ts';

/** Include empty directories so a single-page conflict cannot disappear. */
export function packagePagePaths(repo: Repository, owner: string, outputs = statechartOutputRoots(repo)): ReadonlySet<string> {
  const root = owner.slice(0, -'/README.md'.length);
  const paths = new Set(repo.files(root).filter(path => outsideStatechartOutputs(path, outputs)));
  for (const kind of splitPageKinds(repo.config.pageKinds)) if (repo.inspect?.(`${root}/${kind}`)?.directory) paths.add(`${root}/${kind}/`);
  return paths;
}
