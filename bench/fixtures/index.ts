import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import type { Consumer } from '../../scripts/perf/consumer.js';
import { io, mustRun, PerfError } from '../../scripts/perf/process.js';

export const fixtureConsumer = Effect.fn('bench.fixtureConsumer')(function*(name: string, entry: string, workDir: string, smoke = false, source?: { readonly repository: string; readonly commit: string }) {
  if (!['minimal', 'smoke', 'web', 'writing', 'writing-scale', 'mod'].includes(name)) return yield* new PerfError({ message: `Unknown fixture: ${name}` });
  if (name === 'writing' && !smoke && source) return yield* writingSelfConsumer(entry, workDir, source);
  const root = join(workDir, name);
  yield* io('Create fixture', () => mkdirSync(root));
  const git = (...argv: string[]) => mustRun(['git', '-C', root, ...argv], { cwd: root, outputDir: workDir });
  const cli = (...argv: string[]) => mustRun([process.execPath, entry, '--root', root, '--json', ...argv], { cwd: root, outputDir: workDir });
  yield* git('init', '-q');
  yield* cli('init', '--test-root', 'test', '--source-root', 'src', '--yes');
  for (const feature of ['local-sdlc', 'measured']) yield* cli('new', 'feature', feature, '--title', feature);
  yield* cli('new', 'use-case', 'read', '--title', 'Read', '--feature', 'docs/feature/local-sdlc/README.md');
  const sources = name === 'web' && !smoke ? 1112 : 1;
  const pages = smoke ? 1 : name === 'web' ? 110 : name === 'writing-scale' ? 1000 : 1;
  const fixtureStats = yield* io('Populate fixture', () => {
    if (name === 'smoke') writeFileSync(join(root, 'docs/feature/local-sdlc/README.md'), '# local-sdlc\n\nMOD_READABLE.\n');
    mkdirSync(join(root, 'src'), { recursive: true }); mkdirSync(join(root, 'test'), { recursive: true });
    for (let i = 0; i < sources; i++) writeFileSync(join(root, `src/file-${i}.ts`), `// @concord-file\n// @concord-implements docs/feature/measured/README.md\nexport const value${i} = ${i};\n`);
    writeFileSync(join(root, 'test/read.test.ts'), "// @use-case docs/feature/local-sdlc/use-case/read.md\nimport test from 'node:test';\ntest('read', () => {});\n");
    const pageDir = name.startsWith('writing') || name === 'smoke' ? 'docs/feature/measured/pages' : 'docs/feature/measured';
    mkdirSync(join(root, pageDir), { recursive: true });
    if (name === 'smoke') writeFileSync(join(root, 'docs/feature/measured/page-0.md'), '# Page 0\n\nMeasured content.\n');
    let pageBytes = 0;
    for (let i = 0; i < pages; i++) {
      const prose = name === 'writing-scale' ? Array.from({ length: 100 }, (_, paragraph) =>
        `Measured instrument synchronize consistent authorized preserved diagnostic ${paragraph % 10 === 0 ? '读' : 'performance'} \`code\` \`value\`.\n\n`).join('') : 'Measured content.';
      const page = `# Page ${i}\n\n${prose}\n`; pageBytes += Buffer.byteLength(page);
      writeFileSync(join(root, `${pageDir}/page-${i}.md`), page);
    }
    return { supportingPageBytes: pageBytes, ...(name === 'writing-scale' ? { generatedTokensPerPage: 1000, mixedParagraphPercent: 10, codeTokensPerParagraph: 2 } : {}) };

  });
  if (name.startsWith('writing') || name === 'smoke') {
    yield* io('Write Markdown rules', () => writeFileSync(join(root, 'docs/writing.md'), '# Writing rules\n\n句子不超过 300 个字符，段落不超过 320 个字符。\n\n## 检查范围\n\n- docs/feature/measured/pages\n'));
  }
  yield* git('add', '.');
  yield* git('-c', 'user.name=Concord bench', '-c', 'user.email=bench@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Frozen benchmark fixture');
  const commit = (yield* git('rev-parse', 'HEAD')).stdout.trim();
  yield* cli('cache', 'rebuild');
  const status = yield* cli('cache', 'status');
  // The public status shape has additional diagnostic fields.
  yield* io('Check fixture cache', () => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ status: Schema.Literal('ready') })), { onExcessProperty: 'ignore' })(status.stdout));
  return { kind: 'fixture', fixture: name, root, commit, cache: 'ready', scale: { sources, tests: 1, pages }, fixtureStats } satisfies Consumer;
});

/** A frozen self clone using its declared Markdown terminology and writing rules. */
const writingSelfConsumer = Effect.fn('bench.writingSelfConsumer')(function*(entry: string, workDir: string, source: { readonly repository: string; readonly commit: string }) {
  const root = join(workDir, 'writing');
  const git = (...argv: string[]) => mustRun(['git', '-C', root, ...argv], { cwd: workDir, outputDir: workDir });
  yield* mustRun(['git', 'clone', '-q', '--no-hardlinks', '--no-checkout', source.repository, root], { cwd: workDir, outputDir: workDir });
  yield* git('checkout', '-q', '--detach', source.commit);
  const sourceCommit = (yield* git('rev-parse', 'HEAD')).stdout.trim();
  const cli = (...argv: string[]) => mustRun([process.execPath, entry, '--root', root, '--json', ...argv], { cwd: root, outputDir: workDir });
  const commit = (yield* git('rev-parse', 'HEAD')).stdout.trim();
  const files = (yield* git('ls-files', '-z')).stdout.split('\0').filter(Boolean);
  yield* cli('cache', 'rebuild');
  const status = yield* cli('cache', 'status');
  yield* io('Verify self writing cache', () => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ status: Schema.Literal('ready') })), { onExcessProperty: 'ignore' })(status.stdout));
  return { kind: 'fixture', fixture: 'writing', root, commit, sourceCommit, cache: 'ready', scale: {
    sources: files.filter(path => path.startsWith('src/') && /\.[cm]?[jt]sx?$/u.test(path)).length,
    tests: files.filter(path => path.startsWith('test/') && /\.test\.[cm]?[jt]sx?$/u.test(path)).length,
    pages: files.filter(path => path.startsWith('docs/') && /\.mdx?$/u.test(path)).length,
  } } satisfies Consumer;
});
