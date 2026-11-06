import { readStartupData } from "../../base/installation/startup/index.ts";
import type { StartupData } from "../../model/index.ts";

export async function startupData(): Promise<StartupData | undefined> {
  return readStartupData();
}
