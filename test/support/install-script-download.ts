#!/usr/bin/env bun
// Only the external download boundary is adapted: curl still reads real file:// assets.
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const origin = 'https://github.com/CorrectRoadH/Concord/releases';
const root = process.env.INSTALL_FIXTURE_RELEASE;
const curl = process.env.INSTALL_FIXTURE_CURL;
if (!root || !curl) throw new Error('Missing local release fixture');
const latest = process.env.INSTALL_FIXTURE_LATEST ?? '0.9.3';
const latestTag = process.env.INSTALL_FIXTURE_LATEST_TAG ?? `v${latest}`;
let requested = '';
const args = process.argv.slice(2).map(argument => {
  if (!argument.startsWith('https://')) return argument;
  if (!argument.startsWith(`${origin}/`)) throw new Error(`Network forbidden: ${argument}`);
  requested = argument;
  const relative = argument.slice(origin.length + 1).replace(/^latest$/u, `tag/${latestTag}`);
  return pathToFileURL(`${root}/${relative}`).href;
});
appendFileSync(`${root}/requests`, `${requested}\n`);
const result = spawnSync(curl, args, { encoding: 'utf8' });
process.stdout.write(result.stdout.replace(pathToFileURL(`${root}/tag/${latestTag}`).href, `${origin}/tag/${latestTag}`));
process.stderr.write(result.stderr);
process.exitCode = result.status ?? 1;
