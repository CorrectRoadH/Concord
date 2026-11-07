import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';

const boundary = process.env.CONCORD_TEST_BUSY_BOUNDARY;
const target = process.env.CONCORD_TEST_BUSY_SOURCE;
const original = fs.openSync;
let entered = false;
fs.openSync = ((...args: Parameters<typeof fs.openSync>) => {
  const [path] = args;
  if (!entered && boundary && String(path) === target) {
    entered = true;
    fs.writeFileSync(join(boundary, 'entered'), String(process.pid));
    let value = 1, progress = 0;
    while (!fs.existsSync(join(boundary, 'release'))) {
      for (let index = 0; index < 5_000_000; index++) value = Math.imul(value, 48271) + 1;
      fs.writeFileSync(join(boundary, 'progress'), `${++progress}:${value}`);
    }
  }
  return original(...args);
}) as typeof fs.openSync;
syncBuiltinESMExports();
