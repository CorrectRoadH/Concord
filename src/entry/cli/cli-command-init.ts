// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md#完整路径
// @concord-implements docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md#完整路径
// @concord-implements docs/feature/project-onboarding/use-case/start-writing-specs.md#init
// @concord-implements docs/feature/project-onboarding/use-case/start-writing-specs.md#guide
import { openWriteRepository } from "../../app/index.ts";
import { Effect, Option, Stdio } from "effect";
import { Command, Flag, Prompt } from "effect/unstable/cli";

import { initialize } from "../../app/index.ts";
import { ConcordError, RunnerSchema } from "../../model/index.ts";
import { root, optional, many, body, jsonBody, emit, sync } from "./cli-base.ts";
import { withRepo } from "./cli-repository.ts";

const init = Command.make('init', {
  testRoot: many('test-root'), sourceRoot: many('source-root'), docsOnly: Flag.boolean('docs-only').pipe(Flag.withDefault(false)), runnerConfig: optional('runner-config'),
  yes: Flag.boolean('yes').pipe(Flag.withDefault(false)),
}, args => withRepo((repo, s) => Effect.gen(function*() {
  if (args.docsOnly && args.testRoot.length) return yield* Effect.fail(new ConcordError('ConflictingOptions', '--docs-only cannot be combined with --test-root'));
  const configFile = Option.getOrUndefined(args.runnerConfig);
  const runner = configFile === undefined ? undefined : yield* jsonBody(configFile, RunnerSchema, 'runner configuration');
  const stdio = yield* Stdio.Stdio;
  const interactive = (yield* stdio.stdinIsTerminal) && (yield* stdio.stdoutIsTerminal);
  const options = {
    testRoots: args.docsOnly ? [] : args.testRoot.length ? args.testRoot : undefined, sourceRoots: args.sourceRoot.length ? args.sourceRoot : undefined, runner,
  } as const;
  const preview = yield* initialize(repo, true, options);
  const preimages = yield* sync(() => repo.snapshot(() => {
    return [...preview.createdPaths, ...preview.preservedPaths].map(path => ({ path, source: repo.read(path) }));
  }));
  if (s.dryRun) return preview;
  if (interactive) yield* emit({ operation: 'init-preview', configuration: preview.config, create: preview.createdPaths, preserve: preview.preservedPaths }, s.json);
  const confirmed = args.yes || !interactive || (yield* Prompt.run(Prompt.confirm({ message: `Create ${preview.changedPaths.length} files?`, initial: true })));
  if (!confirmed) return { operation: 'init-cancelled', cancelled: true, dryRun: true, changedPaths: [], plannedPaths: preview.changedPaths };
  yield* sync(() => repo.close());
  const writer = yield* Effect.acquireRelease(openWriteRepository(repo.root, { initialize: true }), (opened) => Effect.sync(() => opened.close()));
  yield* sync(() => writer.snapshot(() => {
    for (const preimage of preimages) if (writer.read(preimage.path) !== preimage.source) throw new ConcordError('FileChangedSinceRead', `${preimage.path} changed since init preview; review a fresh preview`);

  }));
  return yield* initialize(writer, false, options, preview.guide);
}), { initialize: true, readonly: true, unlocked: true })).pipe(Command.withDescription('Progressively initialize static TypeScript configuration, taste, templates and optional configuration. Non-TTY uses deterministic defaults; --dry-run previews and an interactive rejection writes nothing.'));

export { init };
