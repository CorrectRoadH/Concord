// @concord-file
// @concord-implements docs/feature/herdr-mod/ui.md#外观
import { Effect, FileSystem, Schema } from 'effect';
import { join } from 'node:path';
import { failure } from '../../model/index.ts';
import { modIconNames, type ModIconName } from '../../model/herdr-mod/index.ts';

const IconData = Schema.Struct({ __iconData: Schema.Struct({ size: Schema.Number, node: Schema.Array(Schema.Tuple([Schema.String, Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number]))])) }) });
const escape = (value: string | number) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const iconModules: Record<ModIconName, () => Promise<unknown>> = {
  folder: () => import('lucide-react/icons/folder'),
  'folder-open': () => import('lucide-react/icons/folder-open'),
  'file-text': () => import('lucide-react/icons/file-text'),
  route: () => import('lucide-react/icons/route'),
  'flask-conical': () => import('lucide-react/icons/flask-conical'),
  code: () => import('lucide-react/icons/code'),
  'panel-left-close': () => import('lucide-react/icons/panel-left-close'),
  'panel-left-open': () => import('lucide-react/icons/panel-left-open'),
  copy: () => import('lucide-react/icons/copy'),
  x: () => import('lucide-react/icons/x'),
};

/** Read the pinned package's icon data, retaining its ISC and Feather notices. */
export const buildHerdrModResources = Effect.fn('Installation.buildHerdrModResources')(function*(output: string, sourceRoot: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(join(output, 'icons'), { recursive: true });
  yield* Effect.forEach(modIconNames, name => Effect.gen(function*() {
    const module = yield* Effect.tryPromise(iconModules[name]);
    const { __iconData: data } = yield* Schema.decodeUnknownEffect(IconData, { onExcessProperty: 'ignore' })(module);
    const nodes = data.node.map(([tag, props]) => `<${tag} ${Object.entries(props).filter(([key]) => key !== 'key').map(([key, value]) => `${key}="${escape(value)}"`).join(' ')}/>`).join('');
    yield* fs.writeFileString(join(output, 'icons', `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${data.size} ${data.size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${nodes}</svg>\n`);
  }), { concurrency: 'unbounded' });
  yield* fs.writeFileString(join(output, 'NOTICE.txt'), `Concord Herdr mod bundles Effect.\n\n${yield* fs.readFileString(join(sourceRoot, 'node_modules/effect/LICENSE'))}\n\nLucide:\n${yield* fs.readFileString(join(sourceRoot, 'node_modules/lucide-react/LICENSE'))}`);
}, Effect.mapError(failure));
