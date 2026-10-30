// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/use-unified-cache.md
import { runCacheMaintenance } from "../../app/index.js";

import { runWriterMain } from "./main.js";

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";









if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runWriterMain(runCacheMaintenance(process.argv[2]));
}
