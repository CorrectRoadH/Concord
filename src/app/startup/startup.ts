import { resourcePath as installedResourcePath } from "../../base/installation/index.ts";

export const resourcePath: typeof installedResourcePath = path => installedResourcePath(path);
