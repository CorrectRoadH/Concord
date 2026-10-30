export const repositoryDirname = (path: string): string => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';
export function repositoryRelative(from: string, to: string): string {
  const left = from.split('/').filter(part => part !== '' && part !== '.');
  const right = to.split('/').filter(part => part !== '' && part !== '.');
  let shared = 0;
  while (shared < left.length && shared < right.length && left[shared] === right[shared]) shared++;
  return [...left.slice(shared).map(() => '..'), ...right.slice(shared)].join('/');
}
