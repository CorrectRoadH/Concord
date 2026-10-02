import { packConcord } from './release-package.js';
const { name, version, filename } = packConcord(process.argv[2] ?? 'release');
process.stdout.write(`${JSON.stringify({ name, version, filename })}\n`);
