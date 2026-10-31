#!/usr/bin/env node
// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#入口与命令加载
import { Command } from "effect/unstable/cli";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./cli-base.js";
import { runCli } from "./main.js";
import type { StartupData } from "../../model/index.js";

const loaders = {
  new: () => import("./cli-command-documents.js").then(m => m.newDocument),
  show: () => import("./cli-command-documents.js").then(m => m.showDocument),
  list: () => import("./cli-command-documents.js").then(m => m.listDocuments),
  init: () => import("./cli-command-init.js").then(m => m.init),
  recover: () => import("./cli-command-recover.js").then(m => m.recover),
  config: () => import("./cli-command-config.js").then(m => m.config),
  constitution: () => import("./cli-command-constitution.js").then(m => m.constitution),
  memory: () => import("./cli-command-memory.js").then(m => m.memory),
  issue: () => import("./cli-command-issue.js").then(m => m.issue),
  feedback: () => import("./cli-command-feedback.js").then(m => m.feedback),
  test: () => import("./cli-command-test.js").then(m => m.test),
  code: () => import("./cli-command-code.js").then(m => m.code),
  cache: () => import("./cli-command-cache.js").then(m => m.cache),
  docs: () => import("./cli-command-docs.js").then(m => m.docs),
  writing: () => import("./cli-command-writing.js").then(m => m.writing),
  concepts: () => import("./cli-command-concepts.js").then(m => m.concepts),
  check: () => import("./cli-command-check.js").then(m => m.check),
  lsp: () => import("./cli-command-lsp.js").then(m => m.lsp),
  trace: () => import("./cli-command-trace.js").then(m => m.trace),
  review: () => import("./cli-command-review.js").then(m => m.review),
  template: () => import("./cli-command-template.js").then(m => m.templates),
  doctor: () => import("./cli-command-doctor.js").then(m => m.diagnose),
  action: () => import("./cli-command-action.js").then(m => m.action),
  workspace: () => import("./cli-command-workspace.js").then(m => m.workspace),
  git: () => import("./cli-command-git.js").then(m => m.gitView),
  view: () => import("./cli-command-view.js").then(m => m.view),
  server: () => import('./cli-command-server.js').then(m => m.server),
  panel: () => import('./cli-command-panel.js').then(m => m.panel),
};

export async function loadCommand(group: string, data: StartupData): Promise<() => void> {
  const documentKinds = ['use-case', 'design', 'roadmap'] as const;
  const kind = documentKinds.find(name => name === group);
  const selected = kind === undefined ? await loaders[group as keyof typeof loaders]() : (await import("./cli-command-documents.js")).docsGroup(kind);
  // Preserve parent usage and error suggestions. Built-ins and ambiguous routing
  // use the complete definition rather than these sibling descriptors.
  const commands = data.groups.map(item => item.name === group ? selected : Command.make(item.name).pipe(Command.withDescription(item.description ?? '')));
  const command = root.pipe(Command.withSubcommands(commands));
  return () => runCli(command);
}

// Preserve the direct complete-CLI entry used by tooling. The package bin loads
// this module as a library and invokes only the selected command above.
if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const fallback = import.meta.url.endsWith('.ts') ? './cli-fallback.ts' : './cli-fallback-bundle.js';
  await import(fallback);
}
