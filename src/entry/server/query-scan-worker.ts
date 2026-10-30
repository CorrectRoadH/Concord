// @concord-file
// @concord-implements docs/feature/local-data-engine/use-case/query-asynchronous-projections.md
import { NodeRuntime } from "@effect/platform-node";
import { scanQueryProcess } from "../../app/index.js";
NodeRuntime.runMain(scanQueryProcess(process.argv[2], process.argv[3]));
