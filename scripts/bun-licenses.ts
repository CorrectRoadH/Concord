import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, FileSystem, Schema } from 'effect';
import { ArchiveFailed, command, readJson, sha256, verifiedDownload } from './archive-support.ts';

const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u));
const ArchivePath = Schema.String.check(Schema.isPattern(/^(?:[a-zA-Z0-9_@][a-zA-Z0-9_.@+-]*\/)*[a-zA-Z0-9_@][a-zA-Z0-9_.@+-]*$/u));
const BunLicenseSource = Schema.Struct({
  component: Schema.String,
  evidence: Schema.String,
  url: Schema.String.check(Schema.isPattern(/^https:\/\//u)),
  sha256: Digest,
  encoding: Schema.optional(Schema.Literal('base64')),
  files: Schema.optional(Schema.Array(Schema.Struct({ path: ArchivePath, sha256: Digest }))),
});
export const BunLicenseInventory = Schema.Struct({
  version: Schema.Literal('1.4.4'),
  commit: Schema.Literal('38afee6c84fcf48c0edb2466aa4b27d287a59c30'),
  sources: Schema.Array(BunLicenseSource),
});
type BunLicenseSource = typeof BunLicenseSource.Type;

export const loadBunLicenseInventory = () => readJson(fileURLToPath(new URL('./bun-license-sources.json', import.meta.url)), BunLicenseInventory);

/** Only the downloaded bytes or exact license members enter the archive. */
export const copyBunLicenseSources = Effect.fn('archive.bunLicenseSources')(function*(root: string, sources: readonly BunLicenseSource[], cache?: string) {
  const fs = yield* FileSystem.FileSystem;
  const checked = yield* Schema.decodeUnknownEffect(Schema.Array(BunLicenseSource), { onExcessProperty: 'error' })(sources);
  if (!checked.length) return yield* new ArchiveFailed({ message: 'Bun license inventory is empty' });
  yield* fs.makeDirectory(join(root, 'licenses/bun'), { recursive: true });
  const outputs: { file: string; component: string; evidence: string; url: string; downloadSha256: string; sha256: string; archivePath?: string }[] = [];
  for (const [index, source] of checked.entries()) {
    const downloaded = yield* verifiedDownload(source.url, source.sha256, cache);
    const prefix = `${String(index).padStart(3, '0')}-${source.component.replace(/[^a-zA-Z0-9._-]/gu, '_')}`;
    const members = source.files;
    if (members && (!members.length || source.encoding)) return yield* new ArchiveFailed({ message: `Invalid Bun license source: ${source.url}` });
    const texts = members
      ? yield* Effect.forEach(members, member => command('tar', ['-xOf', downloaded, member.path]).pipe(Effect.map(text => ({ name: basename(member.path), bytes: Buffer.from(text), expected: member.sha256, archivePath: member.path }))))
      : [{ name: basename(new URL(source.url).pathname), bytes: source.encoding === 'base64' ? Buffer.from(yield* fs.readFileString(downloaded), 'base64') : yield* fs.readFile(downloaded), expected: undefined, archivePath: undefined }];
    for (const [memberIndex, text] of texts.entries()) {
      const digest = sha256(text.bytes);
      if (!text.bytes.length || (text.expected && digest !== text.expected)) return yield* new ArchiveFailed({ message: `Bun license member SHA-256 mismatch: ${source.url} ${text.archivePath ?? ''}` });
      const file = source.component === 'bun' ? 'BUN-LICENSE.md' : `bun/${prefix}-${memberIndex}-${text.name}`;
      yield* fs.writeFile(join(root, 'licenses', file), text.bytes);
      outputs.push({ file, component: source.component, evidence: source.evidence, url: source.url, downloadSha256: source.sha256, sha256: digest, ...(text.archivePath ? { archivePath: text.archivePath } : {}) });
    }
  }
  return outputs;
});

export const prepareBunLicenses = Effect.fn('archive.bunLicenses')(function*(root: string, version: string, cache?: string) {
  const fs = yield* FileSystem.FileSystem;
  const inventory = yield* loadBunLicenseInventory();
  if (version !== inventory.version) return yield* new ArchiveFailed({ message: `No verified Bun licenses for ${version}` });
  const files = yield* copyBunLicenseSources(root, inventory.sources, cache);
  yield* fs.writeFileString(join(root, 'licenses/BUN-SOURCES.json'), `${JSON.stringify({ version: inventory.version, commit: inventory.commit, files }, null, 2)}\n`);
  return files;
});
