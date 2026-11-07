import { join } from 'node:path';
import { packageRoot } from './location.ts';
import { compiledInstallation } from './compilation.ts';

/** The source and installed runtimes choose their entries in one place. */
export const sourceInstallation = !compiledInstallation;
export const runtimeDirectory = join(packageRoot, sourceInstallation ? 'src' : 'dist');
export const runtimeLoader = (): string[] => sourceInstallation ? ['--no-env-file', '--config=/dev/null', '--conditions=concord-source'] : [];
