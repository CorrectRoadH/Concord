// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/discover-annotated-tests.md

/** Environment inputs and generated distributions are not discovery candidates. */
export const excludedSourceEntry = (name: string): boolean => name === 'dist' || name === '.env' || name.startsWith('.env.');

export const validSourceIgnore = (path: string): boolean => path.length > 0
  && !/[\\:*?\[\]{}!\x00-\x1f\x7f]/u.test(path)
  && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');

/** A configured root is explicit; only exclusions strictly inside it apply. */
export const excludedSourcePath = (path: string, root: string, ignore: readonly string[]): boolean =>
  path.startsWith(`${root}/`) && (path.slice(root.length + 1).split('/').some(excludedSourceEntry)
    || ignore.some(entry => entry.startsWith(`${root}/`) && (path === entry || path.startsWith(`${entry}/`))));
