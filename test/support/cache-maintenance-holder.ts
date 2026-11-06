import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { Effect } from 'effect';
import { openHawdb } from "../../src/base/cache/index.ts";

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);

Effect.runSync(Effect.sync(() => {
  const database = openHawdb(process.argv[2]!, { readOnly: false, create: false }, nativeRuntime);
  process.stdout.write('READY\n');
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', () => {
    database.put('config_cache', [{ key: 'concurrent-writer', payload: 'current writer value' }]);
    process.stdout.write('WROTE\n');
  });
  process.once('SIGTERM', () => { database.close(); process.exit(0); });
}));
