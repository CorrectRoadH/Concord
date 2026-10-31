// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#入口与命令加载
import { Command } from "effect/unstable/cli";
import { root } from "./cli-base.js";
import { init } from "./cli-command-init.js";
import { recover } from "./cli-command-recover.js";
import { config } from "./cli-command-config.js";
import { constitution } from "./cli-command-constitution.js";
import { docsGroup, newDocument, showDocument, listDocuments } from "./cli-command-documents.js";
import { memory } from "./cli-command-memory.js";
import { issue } from "./cli-command-issue.js";
import { feedback } from "./cli-command-feedback.js";
import { test } from "./cli-command-test.js";
import { code } from "./cli-command-code.js";
import { cache } from "./cli-command-cache.js";
import { docs } from "./cli-command-docs.js";
import { writing } from "./cli-command-writing.js";
import { concepts } from "./cli-command-concepts.js";
import { check } from "./cli-command-check.js";
import { lsp } from "./cli-command-lsp.js";
import { trace } from "./cli-command-trace.js";
import { review } from "./cli-command-review.js";
import { templates } from "./cli-command-template.js";
import { diagnose } from "./cli-command-doctor.js";
import { action } from "./cli-command-action.js";
import { workspace } from "./cli-command-workspace.js";
import { gitView } from "./cli-command-git.js";
import { view } from "./cli-command-view.js";
import { server } from './cli-command-server.js';

export const fullCommand = root.pipe(Command.withSubcommands([init,newDocument,showDocument,listDocuments,recover,config,constitution,...(['use-case','design','roadmap'] as const).map(docsGroup),memory,issue,feedback,test,code,cache,docs,writing,concepts,check,lsp,trace,review,templates,diagnose,action,workspace,gitView,view,server,Command.make('panel').pipe(Command.withDescription('Terminal panel (implementation tracked by workspace-server-unimplemented).'))]));
