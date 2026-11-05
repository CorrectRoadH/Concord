import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, FileSystem, Schema } from 'effect';

export class BuildOutputInCheckout extends Schema.TaggedError<BuildOutputInCheckout>()('BuildOutputInCheckout', { message: Schema.String }) {}
export const checkoutRoot = fileURLToPath(new URL('..', import.meta.url));

/** Canonicalize existing ancestors too, so a symlink cannot hide an in-checkout output. */
export const externalBuildOutput = Effect.fn('build.externalOutput')(function*(value: string | undefined) {
  if (!value) return yield* new BuildOutputInCheckout({ message: 'Provide --outDir <directory> outside the checkout.' });
  const fs = yield* FileSystem.FileSystem;
  const checkout = yield* fs.realPath(checkoutRoot);
  let ancestor = resolve(value);
  const missing: string[] = [];
  while (!(yield* fs.exists(ancestor))) { missing.unshift(basename(ancestor)); ancestor = dirname(ancestor); }
  const output = join(yield* fs.realPath(ancestor), ...missing);
  if (output === dirname(output) || output === checkout || output.startsWith(checkout + sep) || checkout.startsWith(output + sep)) {
    return yield* new BuildOutputInCheckout({ message: `Build output must be outside the checkout and its ancestors: ${output}` });
  }
  return output;
});
