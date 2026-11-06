#!/usr/bin/env node
// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#入口与命令加载
import { Command } from "effect/unstable/cli";
import { root } from "./cli-base.ts";
import type { StartupData } from "../../model/index.ts";

const loaders = {
  new: () => import("./cli-command-documents.ts").then(m => m.newDocument),
  show: () => import("./cli-command-documents.ts").then(m => m.showDocument),
  list: () => import("./cli-command-documents.ts").then(m => m.listDocuments),
  init: () => import("./cli-command-init.ts").then(m => m.init),
  skills: () => import("./cli-command-skills.ts").then(m => m.skills),
  recover: () => import("./cli-command-recover.ts").then(m => m.recover),
  config: () => import("./cli-command-config.ts").then(m => m.config),
  taste: () => import("./cli-command-taste.ts").then(m => m.taste),
  memory: () => import("./cli-command-memory.ts").then(m => m.memory),
  issue: () => import("./cli-command-issue.ts").then(m => m.issue),
  feedback: () => import("./cli-command-feedback.ts").then(m => m.feedback),
  test: () => import("./cli-command-test.ts").then(m => m.test),
  code: () => import("./cli-command-code.ts").then(m => m.code),
  cache: () => import("./cli-command-cache.ts").then(m => m.cache),
  docs: () => import("./cli-command-docs.ts").then(m => m.docs),
  writing: () => import("./cli-command-writing.ts").then(m => m.writing),
  concepts: () => import("./cli-command-concepts.ts").then(m => m.concepts),
  check: () => import("./cli-command-check.ts").then(m => m.check),
  lsp: () => import("./cli-command-lsp.ts").then(m => m.lsp),
  trace: () => import("./cli-command-trace.ts").then(m => m.trace),
  review: () => import("./cli-command-review.ts").then(m => m.review),
  template: () => import("./cli-command-template.ts").then(m => m.templates),
  doctor: () => import("./cli-command-doctor.ts").then(m => m.diagnose),
  action: () => import("./cli-command-action.ts").then(m => m.action),
  workspace: () => import("./cli-command-workspace.ts").then(m => m.workspace),
  git: () => import("./cli-command-git.ts").then(m => m.gitView),
  view: () => import("./cli-command-view.ts").then(m => m.view),
  server: () => import('./cli-command-server.ts').then(m => m.server),
  herdr: () => import('./cli-command-herdr.ts').then(m => m.herdr),
};

export async function loadCommand(group: string, data: StartupData) {
  const documentKinds = ['use-case', 'roadmap'] as const;
  const kind = documentKinds.find(name => name === group);
  const selected = kind === undefined ? await loaders[group as keyof typeof loaders]() : (await import("./cli-command-documents.ts")).docsGroup(kind);
  // Preserve parent usage and error suggestions. Built-ins and ambiguous routing
  // use the complete definition rather than these sibling descriptors.
  const commands = data.groups.map(item => item.name === group ? selected : Command.make(item.name).pipe(Command.withDescription(item.description ?? '')));
  const command = root.pipe(Command.withSubcommands(commands));
  return command;
}
