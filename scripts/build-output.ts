import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Schema } from 'effect';

export class BuildOutputInCheckout extends Schema.TaggedError<BuildOutputInCheckout>()('BuildOutputInCheckout', { message: Schema.String }) {}
export const checkoutRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));

/** Canonicalize existing ancestors too, so a symlink cannot hide an in-checkout output. */
export function externalBuildOutput(value: string | undefined): string {
  if (!value) throw new BuildOutputInCheckout({ message: 'Provide --out <directory> outside the checkout.' });
  let ancestor = resolve(value);
  const missing: string[] = [];
  while (!existsSync(ancestor)) { missing.unshift(basename(ancestor)); ancestor = dirname(ancestor); }
  const output = join(realpathSync(ancestor), ...missing);
  if (output === checkoutRoot || output.startsWith(checkoutRoot + sep) || checkoutRoot.startsWith(output + sep)) {
    throw new BuildOutputInCheckout({ message: `Build output must be outside the checkout and its ancestors: ${output}` });
  }
  return output;
}

