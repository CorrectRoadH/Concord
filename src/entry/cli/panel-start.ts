// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#入口与命令加载
import { runPanelInvocation } from './main.js';

/** Only exact, unambiguous spellings arrive here; other input uses Effect CLI. */
export const loadPanelInvocation = (root: string | undefined): (() => void) => () => runPanelInvocation(root);
