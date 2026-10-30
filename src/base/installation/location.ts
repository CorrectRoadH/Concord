import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";

const Package = Schema.fromJsonString(Schema.Struct({ name: Schema.Literal('concord-sdlc') }));
/** Works for emitted modules and the complete CLI bundle alike. */
function locateRoot(): string {
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
