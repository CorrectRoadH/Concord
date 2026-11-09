import { realpathSync } from 'node:fs';
import { tmpdir as systemTemporaryDirectory } from 'node:os';

/** Fixtures use physical paths; macOS exposes its temporary root through /var. */
export const tmpdir = (): string => realpathSync(systemTemporaryDirectory());
