import { createOpenAI } from '@ai-sdk/openai';
import { Effect, Schema } from 'effect';
import type { E2EConfig } from 'e2e';
import config from './e2e.config.ts';

const Required = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));
const Settings = Schema.Struct({ key: Required, baseURL: Required, model: Required });
class E2EModelConfigurationInvalid extends Schema.TaggedError<E2EModelConfigurationInvalid>()('E2EModelConfigurationInvalid', {
  message: Schema.String,
}) {}
const settings = Effect.runSync(Effect.try({
  try: () => Schema.decodeUnknownSync(Settings)({
    key: process.env.E2E_MODEL_API_KEY, baseURL: process.env.E2E_MODEL_BASE_URL, model: process.env.E2E_MODEL,
  }),
  catch: () => new E2EModelConfigurationInvalid({ message: 'Set E2E_MODEL_API_KEY, E2E_MODEL_BASE_URL and E2E_MODEL; run the explicitly authorized test:e2e:agent entry.' }),
}));

const agentConfig: E2EConfig = {
  ...config,
  agents: { default: {
    model: createOpenAI({ apiKey: settings.key, baseURL: settings.baseURL }).responses(settings.model),
    maxModelCalls: 12,
    maxSteps: 20,
  } },
  timeout: 420_000,
};

export default agentConfig;
