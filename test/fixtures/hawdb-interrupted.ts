import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { Effect } from 'effect';
import { openHawdb } from "../../src/base/cache/index.ts";

const nativeRuntime = makeRuntimeEnvironment(process.cwd(), process.env);
Effect.runSync(Effect.sync(() => {
  const database = openHawdb(process.argv[2]!, { readOnly: false, create: false }, nativeRuntime);
  database.put('config_cache', [{ key: 'interrupted', payload: 'committed' }]);
  process.kill(process.pid, 'SIGKILL');
}));
