import { Effect } from 'effect';
import { openHawdb } from '../dist/hawdb-native.js';

Effect.runSync(Effect.sync(() => {
  const database = openHawdb(process.argv[2]!, { readOnly: false, create: false });
  process.stdout.write('READY\n');
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', () => {
    database.put('config_cache', [{ key: 'concurrent-writer', payload: 'current writer value' }]);
    process.stdout.write('WROTE\n');
  });
  process.once('SIGTERM', () => { database.close(); process.exit(0); });
}));
