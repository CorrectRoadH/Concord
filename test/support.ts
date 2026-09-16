import { after as nodeAfter, before as nodeBefore } from 'node:test';
import { Effect } from 'effect';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTypeScriptConfig, renderTypeScriptConfig } from '../dist/config.js';
import { ProjectSchema, decode, type ProjectConfig } from '../dist/shared.js';

type TestEffect = Effect.Effect<void, unknown, never>;

export const effectBefore = (program: TestEffect): void => {
  nodeBefore(() => Effect.runPromise(program));
};

export const effectAfter = (program: TestEffect): void => {
  nodeAfter(() => Effect.runPromise(program));
};

export const projectConfigPath = (_root: string): 'concord.config.ts' => 'concord.config.ts';
export const readProjectConfig = (root: string): ProjectConfig => {
  const path = projectConfigPath(root), source = readFileSync(join(root, path), 'utf8');
  return parseTypeScriptConfig(source);
};
export const writeProjectConfig = (root: string, input: unknown): void => {
  const config = decode(ProjectSchema, input, 'test project configuration');
  const path = projectConfigPath(root);
  writeFileSync(join(root, path), renderTypeScriptConfig(config));
};
