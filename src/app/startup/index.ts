import { readStartupData } from "../../base/installation/startup/index.js";
import type { StartupData } from "../../model/index.js";

export async function startupData(): Promise<StartupData | undefined> {
  return readStartupData();
}
