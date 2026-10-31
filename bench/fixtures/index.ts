import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Schema } from 'effect';
import type { Consumer } from '../../scripts/perf/consumer.js';
import { io, mustRun, PerfError } from '../../scripts/perf/process.js';

export const fixtureConsumer = Effect.fn('bench.fixtureConsumer')(function*(name: string, entry: string, workDir: string, smoke = false, source?: { readonly repository: string; readonly commit: string }) {
  if (!['minimal', 'smoke', 'web', 'writing', 'writing-scale', 'panel'].includes(name)) return yield* new PerfError({ message: `Unknown fixture: ${name}` });
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
    if (name === 'panel' || name === 'smoke') writeFileSync(join(root, 'docs/feature/local-sdlc/README.md'), '# local-sdlc\n\nPANEL_READABLE.\n');
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
    const shown = yield* cli('writing', 'show');
    const digest = yield* io('Decode writing preimage', () => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ digest: Schema.String })), { onExcessProperty: 'ignore' })(shown.stdout).digest);
    const word = (n: number): string => `word${String.fromCharCode(97 + Math.floor(n / 676), 97 + Math.floor(n / 26) % 26, 97 + n % 26)}`;
    const input = join(workDir, 'writing-policy.json');
    yield* io('Prepare controlled policy', () => writeFileSync(input, JSON.stringify({
      format: 'concord.writing/v3', roots: ['docs/feature/measured/pages'], bannedTerms: [],
      sentenceLength: 300, paragraphLength: 320,
      controlled: {
        language: 'auto', sentence: { zh: { procedural: 30, descriptive: 40 }, en: { procedural: 20, descriptive: 25 } }, paragraphSentences: 6,
        procedural: { singleInstruction: true, requireVerb: true, verbs: { zh: ['读取'], en: [{ lemma: 'read' }] } },
        approvedWords: { enabled: true, en: [...new Set('measured content instrument synchronize consistent authorized preserved diagnostic performance'.split(' ')), ...Array.from({ length: name === 'writing-scale' ? 4087 : 30 }, (_, i) => word(i))] },
        passiveVoice: { zh: true, en: true, participles: ['measured'] },
      },
    })));
    yield* cli('writing', 'set', '--body', input, '--expected-digest', digest);
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

/** A frozen self clone with both length paths and a lexical scan enabled. */
const writingSelfConsumer = Effect.fn('bench.writingSelfConsumer')(function*(entry: string, workDir: string, source: { readonly repository: string; readonly commit: string }) {
  const root = join(workDir, 'writing');
  const git = (...argv: string[]) => mustRun(['git', '-C', root, ...argv], { cwd: workDir, outputDir: workDir });
  yield* mustRun(['git', 'clone', '-q', '--no-hardlinks', '--no-checkout', source.repository, root], { cwd: workDir, outputDir: workDir });
  yield* git('checkout', '-q', '--detach', source.commit);
  const sourceCommit = (yield* git('rev-parse', 'HEAD')).stdout.trim();
  const cli = (...argv: string[]) => mustRun([process.execPath, entry, '--root', root, '--json', ...argv], { cwd: root, outputDir: workDir });
  const shown = yield* cli('writing', 'show');
  const previous = yield* io('Decode self writing policy', () => Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ digest: Schema.String, policy: Schema.Record(Schema.String, Schema.Json) })), { onExcessProperty: 'ignore' })(shown.stdout));
  const input = join(workDir, 'self-writing-policy.json');
  yield* io('Prepare self controlled policy', () => writeFileSync(input, JSON.stringify({
    ...previous.policy,
    controlled: { language: 'auto', sentence: { zh: { procedural: 100000, descriptive: 100000 }, en: { procedural: 100000, descriptive: 100000 } },
      paragraphSentences: 100000, passiveVoice: { en: true, participles: ['benchparticiple'] } },
  })));
  yield* cli('writing', 'set', '--body', input, '--expected-digest', previous.digest);
  yield* git('add', 'docs/concord-writing.json');
  yield* git('-c', 'user.name=Concord bench', '-c', 'user.email=bench@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Frozen controlled writing self consumer');
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
