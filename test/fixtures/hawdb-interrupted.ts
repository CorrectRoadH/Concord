import { Effect } from 'effect';
import { openHawdb } from '../../src/hawdb-native.js';
Effect.runSync(Effect.sync(() => {
  const database = openHawdb(process.argv[2]!, { readOnly: false, create: false });
  database.put('config_cache', [{ key: 'interrupted', payload: 'committed' }]);
  process.kill(process.pid, 'SIGKILL');
}));
