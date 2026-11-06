import { readStartupData, initializeNodeCompileCache as initializeCache, resourcePath as installedResourcePath } from "../../base/installation/startup/index.ts";
import type { StartupData } from "../../model/index.ts";
export function initializeNodeCompileCache(): string {
  return initializeCache();
}

export async function startupData(): Promise<StartupData | undefined> {
  return readStartupData();
}

export const resourcePath: typeof installedResourcePath = path => installedResourcePath(path);
