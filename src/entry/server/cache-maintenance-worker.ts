// @concord-file
// @concord-implements docs/engineering/build/architecture.md#编译入口
import { pathToFileURL } from 'node:url';
import { run } from './cache-maintenance-worker-main.ts';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run();
}
