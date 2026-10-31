import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from './temporary.js';
import { join } from 'node:path';
import { after } from 'node:test';
import { defaultWritingSource } from '../../src/model/index.js';
import { writeProjectConfig } from './support.js';
export function git(root: string, ...args: string[]) { const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); }
function buildFixture(docsWork?: unknown, initialConfig = true) {
  const root = mkdtempSync(join(tmpdir(), 'concord-docs-work-'));
  git(root, 'init', '-q'); git(root, 'config', 'user.name', 'Docs Work'); git(root, 'config', 'user.email', 'docs-work@example.test');
  mkdirSync(join(root, 'docs/a'), { recursive: true }); mkdirSync(join(root, 'docs/b'));
  writeFileSync(join(root, 'docs/a/one.md'), '# One\n\nClear text.\n'); writeFileSync(join(root, 'docs/b/two.md'), '# Two\n\nClear text.\n');
  writeFileSync(join(root, 'docs/README.md'), '# Documentation\n');
  writeFileSync(join(root, 'docs/input.md'), '# Input\n'); writeFileSync(join(root, 'outside.txt'), 'Outside\n');
  if (initialConfig) writeProjectConfig(root, { testRoots: [], sourceRoots: [], runner: { kind: 'command', argv: [process.execPath, '-e', 'process.exit(0)'], sourceFiles: [], timeoutMs: 1000 }, ...(docsWork === undefined ? {} : { docsWork }) });
  writeFileSync(join(root, 'docs/writing.md'), defaultWritingSource);
  git(root, 'add', "."); git(root, 'commit', '-qm', 'fixture');
  return root;
}
export function waitingProcess(childPidPath: string, groupPidPath?: string): string {
  const descendant = 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)';
  return `const {spawn}=require("node:child_process");const fs=require("node:fs");const child=spawn(process.execPath,["-e",${JSON.stringify(descendant)}],{stdio:"ignore"});fs.writeFileSync(${JSON.stringify(childPidPath)},String(child.pid));${groupPidPath === undefined ? '' : `fs.writeFileSync(${JSON.stringify(groupPidPath)},String(process.pid));`}process.on("SIGTERM",()=>{});setInterval(()=>{},1000)`;
}
export const custom = { checks: { ok: { argv: [process.execPath, '-e', 'const fs=require("node:fs");fs.writeFileSync("check-count",String(Number(fs.existsSync("check-count")?fs.readFileSync("check-count","utf8"):0)+1));console.log(process.argv.slice(1).join("|"))', '{paths}'] }, failed: { argv: [process.execPath, '-e', 'const fs=require("node:fs");fs.writeFileSync("failed-count",String(Number(fs.existsSync("failed-count")?fs.readFileSync("failed-count","utf8"):0)+1));console.log("failed output");process.exit(7)'] } }, finalizer: { argv: [process.execPath, '-e', 'const fs=require("node:fs");fs.writeFileSync("finalizer-count",String(Number(fs.existsSync("finalizer-count")?fs.readFileSync("finalizer-count","utf8"):0)+1));console.log("finalized")'] } };

const templates = new Map<string, string>();
export function fixture(docsWork?: unknown, initialConfig = true): string {
  const key = JSON.stringify({ docsWork, initialConfig });
  let template = templates.get(key);
  if (template === undefined) { template = buildFixture(docsWork, initialConfig); templates.set(key, template); }
  const root = mkdtempSync(join(tmpdir(), 'concord-docs-work-consumer-'));
  cpSync(template, root, { recursive: true });
  return root;
}
after(() => { for (const path of templates.values()) rmSync(path, { recursive: true, force: true }); });
