import { packConcord } from './release-package.js';
process.stdout.write(`${JSON.stringify(packConcord(process.argv[2] ?? 'release'))}\n`);
