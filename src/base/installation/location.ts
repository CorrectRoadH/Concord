import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as Schema from "effect/Schema";
import { compiledInstallation } from './compilation.ts';

const Package = Schema.fromJsonString(Schema.Struct({ name: Schema.Literal('concord-sdlc') }));
/** Works for emitted modules and the complete CLI bundle alike. */
function locateRoot(): string {
  if (compiledInstallation) {
    const root = join(dirname(dirname(realpathSync(process.execPath))), 'app');
    Schema.decodeUnknownSync(Package, { onExcessProperty: 'ignore' })(readFileSync(join(root, 'package.json'), 'utf8'));
    return root;
  }
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    try {
      Schema.decodeUnknownSync(Package, { onExcessProperty: 'ignore' })(readFileSync(join(directory, 'package.json'), 'utf8'));
      return directory;
    } catch { /* Continue to the enclosing installation. */ }
    const parent = dirname(directory);
    if (parent === directory) throw new Error('InstallationUnavailable: cannot locate Concord package root');
    directory = parent;
  }
}
export const packageRoot = locateRoot();
