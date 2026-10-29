// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md#完整路径
import { randomUUID } from 'node:crypto';
import { Effect, Option, Schema } from 'effect';
import { Command, Flag, Prompt } from 'effect/unstable/cli';
import { initialize, LocalRepository } from './storage.js';
import { ConcordError, MemorySourceSchema, RunnerSchema, decode } from './shared.js';
import { adoptConstitution } from './constitution.js';
import { root, text, optional, many, body, jsonBody, emit, sync } from './cli-base.js';
import { withRepo } from './cli-repository.js';

const init = Command.make('init', {
  testRoot: many('test-root'), sourceRoot: many('source-root'), docsOnly: Flag.boolean('docs-only').pipe(Flag.withDefault(false)), runnerConfig: optional('runner-config'),
  projectType: Flag.choice('project-type', ['library', 'cli']).pipe(Flag.atLeast(0)), pages: many('pages'), noDefaultPages: Flag.boolean('no-default-pages').pipe(Flag.withDefault(false)),
  design: Flag.boolean('design').pipe(Flag.withDefault(false)), constitutionBody: optional('constitution-body'), adoptConstitution: Flag.boolean('adopt-constitution').pipe(Flag.withDefault(false)),
  constitutionReason: optional('constitution-reason'), constitutionImpact: optional('constitution-impact'), constitutionSource: many('constitution-source'), memorySources: optional('memory-sources'), yes: Flag.boolean('yes').pipe(Flag.withDefault(false)),
}, args => withRepo((repo, s) => Effect.gen(function*() {
  if (args.docsOnly && args.testRoot.length) return yield* Effect.fail(new ConcordError('ConflictingOptions', '--docs-only cannot be combined with --test-root'));
  if (args.noDefaultPages && args.pages.length) return yield* Effect.fail(new ConcordError('ConflictingOptions', '--no-default-pages cannot be combined with --pages'));
  const configFile = Option.getOrUndefined(args.runnerConfig);
  const runner = yield* sync(() => configFile === undefined ? undefined : jsonBody(configFile, RunnerSchema, 'runner configuration'));
  const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
  const projectTypes = args.projectType.length > 0 ? args.projectType : interactive ? yield* Prompt.run(Prompt.multiSelect({ message: 'Project types', choices: [{ title: 'Library', value: 'library' as const }, { title: 'CLI', value: 'cli' as const }] })) : [];
  const design = args.design || interactive && (yield* Prompt.run(Prompt.confirm({ message: 'Create root DESIGN.md?', initial: false })));
  const selectedPages = args.noDefaultPages ? [] : args.pages.length > 0 ? args.pages.flatMap((value) => value.split(',').map((page) => page.trim())) : undefined;
  const recommendedPages = [...new Set(projectTypes.flatMap((type) => type === 'library' ? ['library', 'architecture'] as const : ['cli', 'architecture'] as const))];
  const pages = selectedPages === undefined && interactive ? yield* Prompt.run(Prompt.multiSelect({ message: 'Default pages for new Feature, Roadmap, and Design documents', choices: [
    { title: 'Library', value: 'library' as const, selected: recommendedPages.includes('library') },
    { title: 'CLI', value: 'cli' as const, selected: recommendedPages.includes('cli') },
    { title: 'Architecture', value: 'architecture' as const, selected: recommendedPages.includes('architecture') },
    { title: 'Lifecycle', value: 'lifecycle' as const },
    { title: 'Use-case index', value: 'use-case' as const },
  ] })) : selectedPages === undefined ? undefined : yield* sync(() => decode(Schema.Array(Schema.Literals(['library', 'cli', 'architecture', 'lifecycle', 'use-case'])), selectedPages, 'default pages'));
  const memoryFile = Option.getOrUndefined(args.memorySources);
  let memorySources = yield* sync(() => memoryFile === undefined ? undefined : [...jsonBody(memoryFile, Schema.NonEmptyArray(MemorySourceSchema), 'Memory sources')]);
  if (memorySources === undefined && interactive) {
    memorySources = [{ name: 'project', provider: 'local-files', path: 'memory', access: 'read-write', defaultWrite: true }];
    while (yield* Prompt.run(Prompt.confirm({ message: 'Add another local-files Memory source?', initial: false }))) {
      const name = yield* Prompt.run(Prompt.text({ message: 'Memory source name' }));
      const path = yield* Prompt.run(Prompt.text({ message: 'Repository-relative Memory directory' }));
      const access = yield* Prompt.run(Prompt.select({ message: 'Memory source access', choices: [{ title: 'Read/write', value: 'read-write' as const }, { title: 'Read-only', value: 'read-only' as const }] }));
      const makeDefault = access === 'read-write' && (yield* Prompt.run(Prompt.confirm({ message: 'Use this as the default write source?', initial: false })));
      if (makeDefault) memorySources = memorySources.map((source) => ({ ...source, defaultWrite: false }));
      memorySources.push({ name, provider: 'local-files', path, access, ...(makeDefault ? { defaultWrite: true } : {}) });
    }
  }
  const memorySourceConfig = yield* sync(() => memorySources === undefined ? undefined : decode(Schema.NonEmptyArray(MemorySourceSchema), memorySources, 'Memory sources'));
  const constitutionBody = yield* sync(() => Option.isSome(args.constitutionBody) ? body(args.constitutionBody.value) : undefined);
  const options = {
    projectId: randomUUID(),
    testRoots: args.docsOnly ? [] : args.testRoot.length ? args.testRoot : undefined, sourceRoots: args.sourceRoot.length ? args.sourceRoot : undefined, runner,
    projectTypes, pages, design, constitutionBody,
    adoptConstitution: args.adoptConstitution, constitutionReason: Option.getOrUndefined(args.constitutionReason), constitutionImpact: Option.getOrUndefined(args.constitutionImpact), constitutionSources: args.constitutionSource, memorySources: memorySourceConfig,
  } as const;
  const { preview, preimages } = yield* sync(() => repo.snapshot(() => {
    const preview = initialize(repo, true, options);
    const preimages = [...preview.createdPaths, ...preview.preservedPaths].map(path => ({ path, source: repo.read(path) }));
    return { preview, preimages };
  }));
  if (s.dryRun) return preview;
  if (interactive) yield* Effect.sync(() => emit({ operation: 'init-preview', configuration: preview.config, create: preview.createdPaths, preserve: preview.preservedPaths }, s.json));
  const confirmed = args.yes || !interactive || (yield* Prompt.run(Prompt.confirm({ message: `Create ${preview.changedPaths.length} files?`, initial: true })));
  if (!confirmed) return { operation: 'init-cancelled', cancelled: true, dryRun: true, changedPaths: [], plannedPaths: preview.changedPaths };
  yield* sync(() => repo.close());
  const writer = yield* Effect.acquireRelease(sync(() => new LocalRepository(repo.root, { initialize: true })), (opened) => Effect.sync(() => opened.close()));
  return yield* sync(() => writer.snapshot(() => {
    for (const preimage of preimages) if (writer.read(preimage.path) !== preimage.source) throw new ConcordError('PreimageChanged', `${preimage.path} changed since init preview; review a fresh preview`);
    return initialize(writer, false, options);
  }));
}), { initialize: true, readonly: true, unlocked: true })).pipe(Command.withDescription('Progressively initialize static TypeScript configuration, constitution, templates and optional DESIGN.md. Non-TTY uses deterministic defaults; --dry-run previews and an interactive rejection writes nothing.'));

export { init };
