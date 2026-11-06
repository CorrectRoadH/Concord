/** Current archives expose a shell launcher; historical JS artifacts and source
 * smoke fixtures run through the current Node executable. */
export function packageCommand(entry: string): [string, ...string[]] {
  return /\.[cm]?[jt]s$/u.test(entry) ? [process.execPath, entry] : [entry];
}
