import { readStartupData, initializeNodeCompileCache as initializeCache } from "../../base/installation/startup/index.ts";
import type { StartupData } from "../../model/index.ts";
export function initializeNodeCompileCache(): string {
  return initializeCache();
}

export async function startupData(): Promise<StartupData | undefined> {
  return readStartupData();
}
