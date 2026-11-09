// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md#adopt
import { posix } from 'node:path';
import { relocateMarkdown } from './link-relocation.ts';

export function rebaseAdoptedMarkdown(source: string, sourcePath: string, destinationPath: string, sourceDirectory: string, targetDirectory?: string): string {
  const destinationDirectory = targetDirectory ?? destinationPath.slice(0, -posix.relative(sourceDirectory, sourcePath).length - 1);
  return relocateMarkdown(source, sourcePath, destinationPath, target => target === sourceDirectory || target.startsWith(`${sourceDirectory}/`) ? `${destinationDirectory}${target.slice(sourceDirectory.length)}` : target);
}
