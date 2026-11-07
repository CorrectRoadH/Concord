// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { runCacheMaintenance } from '../../app/index.ts';
import { runWriterMain } from './main.ts';

export function run(): void {
  runWriterMain(runCacheMaintenance(process.argv[2]));
}
