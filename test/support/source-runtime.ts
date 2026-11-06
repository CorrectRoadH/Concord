import { installProcessEvents } from './process-events.ts';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Destructive fixtures own their native cache; read-only source consumers share it.
let owner = dirname(resolve(process.argv[1] ?? '.'));
for (;;) {
  if (existsSync(join(owner, 'package.json')) && existsSync(join(owner, 'src/entry/cli/entry.ts'))) {
    if (existsSync(join(owner, '.test-cache'))) process.env.XDG_CACHE_HOME = join(owner, '.test-cache');
    break;
  }
  const parent = dirname(owner);
  if (parent === owner) break;
  owner = parent;
}

const eventContext = new URL(import.meta.url).searchParams;
if (eventContext.has('eventRun') && eventContext.has('eventDirectory')) installProcessEvents({ run: eventContext.get('eventRun')!, directory: eventContext.get('eventDirectory')! });
