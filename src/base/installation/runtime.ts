import { join } from 'node:path';
import { packageRoot } from './location.ts';

/** The source and installed runtimes choose their entries in one place. */
export const sourceInstallation = import.meta.url.endsWith('.ts');
export const runtimeDirectory = join(packageRoot, sourceInstallation ? 'src' : 'dist');
export const runtimeLoader = (): string[] => sourceInstallation ? ['--import', import.meta.resolve('tsx')] : [];
