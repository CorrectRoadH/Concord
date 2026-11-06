// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md#agent-指引的边界
// @concord-implements docs/feature/project-onboarding/use-case/start-writing-specs.md#read-guide
// @concord-implements docs/feature/project-onboarding/use-case/run-workflow-from-agent.md#follow
import { Effect, FileSystem, Schema } from "effect";
import { resourcePath } from "../../app/startup/index.ts";
import { ConcordError } from "../../model/index.ts";
import { CliInvocation } from "./invocation.ts";
import { cliFailure } from "./cli-failure.ts";
import { writeStdout } from './invocation.ts';

const TOPICS = ['init', 'docs-from-scratch', 'docs-from-code', 'document', 'code', 'test', 'memory', 'trace', 'recovery', 'view', 'feedback', 'spec', 'implement', 'review', 'fix'] as const;
const TopicSchema = Schema.Literals(TOPICS);
const ArgvSchema = Schema.Array(Schema.String);
const SkillContentSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(1024 * 1024),
  Schema.isPattern(/^[^\0]+$/u),
);

type Topic = typeof TopicSchema.Type;

export class SkillArgumentsInvalid extends Schema.TaggedError<SkillArgumentsInvalid>()('SkillArgumentsInvalid', {
  code: Schema.Literal('SkillArgumentsInvalid'),
  message: Schema.String,
}) {}

export class SkillTopicUnknown extends Schema.TaggedError<SkillTopicUnknown>()('SkillTopicUnknown', {
  code: Schema.Literal('SkillTopicUnknown'),
  message: Schema.String,
}) {}

export class SkillContentUnreadable extends Schema.TaggedError<SkillContentUnreadable>()('SkillContentUnreadable', {
  code: Schema.Literal('SkillContentUnreadable'),
  message: Schema.String,
}) {}

export class SkillContentInvalid extends Schema.TaggedError<SkillContentInvalid>()('SkillContentInvalid', {
  code: Schema.Literal('SkillContentInvalid'),
  message: Schema.String,
}) {}

const decodeArgv = Schema.decodeUnknownSync(ArgvSchema, { onExcessProperty: 'error', errors: 'all' });
const decodeTopic = Schema.decodeUnknownSync(TopicSchema, { onExcessProperty: 'error', errors: 'all' });
const decodeContent = Schema.decodeUnknownEffect(SkillContentSchema, { errors: 'all' });

function parseRequest(input: unknown): Topic | 'main' | 'all' {
  let argv: readonly string[];
  try {
    argv = decodeArgv(input);
  } catch {
    throw new SkillArgumentsInvalid({ code: 'SkillArgumentsInvalid', message: 'concord --skill only accepts an optional topic' });
  }
  if (argv[0] !== '--skill' || argv.length > 2) {
    throw new SkillArgumentsInvalid({ code: 'SkillArgumentsInvalid', message: `Use concord --skill [${[...TOPICS, 'all'].join('|')}] without other commands or flags` });
  }
  const requested = argv[1];
  if (requested === undefined) return 'main';
  if (requested === 'all') return 'all';
  try {
    return decodeTopic(requested);
  } catch {
    throw new SkillTopicUnknown({ code: 'SkillTopicUnknown', message: `Unknown skill topic: ${requested}` });
  }
}

const skillPath = (topic: Topic | 'main'): string => resourcePath(
  topic === 'main' ? 'skills/concord/SKILL.md' : `skills/concord/references/${topic}.md`,
);

const readTopic = Effect.fn('readSkillTopic')(function*(topic: Topic | 'main') {
  const fs = yield* FileSystem.FileSystem;
  const content = yield* fs.readFileString(skillPath(topic)).pipe(
    Effect.mapError(() => new SkillContentUnreadable({ code: 'SkillContentUnreadable', message: `Cannot read packaged skill topic: ${topic}` })),
  );
  return yield* decodeContent(content).pipe(
    Effect.mapError(() => new SkillContentInvalid({ code: 'SkillContentInvalid', message: `Packaged skill topic is invalid: ${topic}` })),
  );
});

export const skillProgram = Effect.fn('skillProgram')(function*(argv: unknown) {
  const request = yield* Effect.try({
    try: () => parseRequest(argv),
    catch: cause => cause as SkillArgumentsInvalid | SkillTopicUnknown,
  });
  const topics: readonly (Topic | 'main')[] = request === 'all' ? ['main', ...TOPICS] : [request];
  const sections = yield* Effect.forEach(topics, readTopic, { concurrency: 1 });
  yield* writeStdout(`${sections.map(section => section.trimEnd()).join('\n\n---\n\n')}\n`);
});

export const skillCommand = (argv: readonly string[]) => Effect.scoped(Effect.gen(function*() {
  yield* skillProgram(argv).pipe(
    Effect.catchTags({
      SkillArgumentsInvalid: error => cliFailure(new ConcordError(error.code, error.message)),
      SkillTopicUnknown: error => cliFailure(new ConcordError(error.code, error.message)),
      SkillContentUnreadable: error => cliFailure(new ConcordError(error.code, error.message)),
      SkillContentInvalid: error => cliFailure(new ConcordError(error.code, error.message)),
    }),
    Effect.catch(cliFailure),
  );
  return yield* (yield* CliInvocation).exitCode;
})).pipe(Effect.provide(CliInvocation.layer(argv)));
