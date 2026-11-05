import { Effect, Schema } from 'effect';
import { build, type InlineConfig, type Rolldown } from 'vite-plus/pack';
import { minify } from 'vite/rolldown/utils';

class JavaScriptPackFailed extends Schema.TaggedError<JavaScriptPackFailed>()('JavaScriptPackFailed', {
  message: Schema.String,
}) {}

/** Publish the notice at the path declared in docs/notices.md without rewriting JS. */
export const p5RuntimeNotice: Rolldown.Plugin = {
  name: 'concord-p5-runtime-notice',
  async generateBundle(_options, bundle) {
    const entry = bundle['p5-runtime.js'];
    if (entry?.type !== 'chunk') throw new JavaScriptPackFailed({ message: 'Missing p5 runtime bundle' });
    const result = await minify(entry.fileName, entry.code, { compress: false, mangle: false, codegen: { legalComments: 'external' } });
    if (result.errors.length > 0 || result.legalComments.length === 0) throw new JavaScriptPackFailed({ message: 'Unable to extract p5 runtime legal comments' });
    this.emitFile({ type: 'asset', fileName: 'p5-runtime.js.LEGAL.txt', source: result.legalComments.join('\n') + '\n' });
  },
};

/** Own the pack build handles for one non-watching package assembly step. */
export const packJavaScript = Effect.fn('build.packJavaScript')(function*(config: InlineConfig) {
  yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () => build({ config: false, clean: false, dts: false, sourcemap: true, ...config }),
      catch: cause => new JavaScriptPackFailed({ message: String(cause) }),
    }),
    handle => Effect.promise(async () => {
      for (const bundle of handle.bundles) await bundle[Symbol.asyncDispose]();
    }),
  );
}, Effect.scoped);
