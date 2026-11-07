import { installProcessEvents } from './process-events.ts';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Destructive fixtures own their native cache; read-only source consumers share it.
const entry = process.env.CONCORD_TEST_BUN_FILE_ROOT === '1' ? process.env.CONCORD_TEST_FILE_ID : process.argv[1];
let owner = dirname(resolve(entry ?? '.'));
for (;;) {
  if (existsSync(join(owner, 'package.json')) && existsSync(join(owner, 'src/entry/cli/entry.ts'))) {
    if (existsSync(join(owner, '.test-cache'))) process.env.XDG_CACHE_HOME = join(owner, '.test-cache');
    break;
  }
  const parent = dirname(owner);
  if (parent === owner) break;
  owner = parent;
}

if (process.env.CONCORD_TEST_RUN_ID && process.env.CONCORD_TEST_EVENT_DIRECTORY) {
  installProcessEvents({ run: process.env.CONCORD_TEST_RUN_ID, directory: process.env.CONCORD_TEST_EVENT_DIRECTORY });
}
