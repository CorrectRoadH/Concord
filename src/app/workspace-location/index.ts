// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#入口与命令加载
import { discoverRoot as locate } from '../../base/workspace/index.ts';

/** Root selection does not require repository configuration or application loading. */
export const discoverRoot: typeof locate = (...args) => locate(...args);
