// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/discover-annotated-tests.md

/** Environment inputs and generated distributions are not discovery candidates. */
export const excludedSourceEntry = (name: string): boolean => name === 'dist' || name === '.env' || name.startsWith('.env.');
