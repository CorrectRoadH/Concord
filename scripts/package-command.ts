/** Archives execute directly; source fixtures use the pinned Bun environment. */
export function packageCommand(entry: string): [string, ...string[]] {
  return /\.[cm]?[jt]s$/u.test(entry) ? ['bun', '--no-env-file', '--config=/dev/null', entry] : [entry];
}
