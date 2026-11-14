// @concord-file
// @concord-implements docs/engineering/build/architecture.md#编译入口
import { join } from 'node:path';
import { Effect, FileSystem, Schema } from 'effect';
import { ArchiveFailed, command, run } from './archive-support.ts';

/** Exercise the installed executable after relocation and signing. */
export const validateArchiveDatabase = Effect.fn('archive.database')(function*(installation: string) {
  const fs = yield* FileSystem.FileSystem;
  const workspace = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'concord-archive-database-' }));
  yield* run('git', ['init', '--quiet', workspace]);
  const executable = join(installation, 'bin/concord');
  const invoke = (args: readonly string[]) => command(executable, ['--root', workspace, '--json', '--server=command', ...args], workspace);
  yield* invoke(['init', '--docs-only']);
  const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({
    documents: Schema.Array(Schema.Struct({ path: Schema.String, body: Schema.String })),
  })), { onExcessProperty: 'ignore' });
  for (const [kind, directory] of [['memory', 'memory'], ['issue', 'docs/issues']] as const) {
    yield* fs.makeDirectory(join(workspace, directory), { recursive: true });
    const path = `${directory}/archive.md`;
    const body = `# Archive ${kind}\n\nInstalled database needle.\n`;
    yield* fs.writeFileString(join(workspace, path), body);
    const result = yield* decode(yield* invoke([kind, 'search', 'installed database needle']));
    if (result.documents.length !== 1 || result.documents[0]?.path !== path || result.documents[0]?.body !== body) {
      return yield* new ArchiveFailed({ message: `Installed ${kind} search returned incorrect documents` });
    }
  }
  yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ status: Schema.Literal('ready') })), { onExcessProperty: 'ignore' })(yield* invoke(['cache', 'status']));
}, Effect.scoped);
