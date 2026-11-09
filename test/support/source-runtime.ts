import { installProcessEvents } from './process-events.ts';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { after } from 'node:test';

// Destructive fixtures own their native cache; read-only source consumers share it.
const entry = process.argv[1];
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
  const file = resolve(process.argv[1] ?? 'unknown');
  const testFile = /\.test\.[cm]?[jt]sx?$/u.test(file);
  const release = installProcessEvents({ run: process.env.CONCORD_TEST_RUN_ID, directory: process.env.CONCORD_TEST_EVENT_DIRECTORY,
    ...(testFile ? { file } : {}) });
  if (testFile) after(release);
}
