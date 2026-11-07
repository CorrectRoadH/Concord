// @concord-file
// @concord-implements docs/feature/local-sdlc/architecture.md#入口与命令加载
import { Command } from "effect/unstable/cli";
import { root } from "./cli-base.ts";
import { init } from "./cli-command-init.ts";
import { skills } from './cli-command-skills.ts';
import { recover } from "./cli-command-recover.ts";
import { config } from "./cli-command-config.ts";
import { taste } from "./cli-command-taste.ts";
import { docsGroup, newDocument, showDocument, listDocuments } from "./cli-command-documents.ts";
import { memory } from "./cli-command-memory.ts";
import { issue } from "./cli-command-issue.ts";
import { feedback } from "./cli-command-feedback.ts";
import { test } from "./cli-command-test.ts";
import { code } from "./cli-command-code.ts";
import { cache } from "./cli-command-cache.ts";
import { docs } from "./cli-command-docs.ts";
import { writing } from "./cli-command-writing.ts";
import { concepts } from "./cli-command-concepts.ts";
import { check } from "./cli-command-check.ts";
import { lsp } from "./cli-command-lsp.ts";
import { trace } from "./cli-command-trace.ts";
import { review } from "./cli-command-review.ts";
import { templates } from "./cli-command-template.ts";
import { diagnose } from "./cli-command-doctor.ts";
import { action } from "./cli-command-action.ts";
import { workspace } from "./cli-command-workspace.ts";
import { gitView } from "./cli-command-git.ts";
import { view } from "./cli-command-view.ts";
import { server } from './cli-command-server.ts';
import { herdr } from './cli-command-herdr.ts';

import { schema } from './cli-command-schema.ts';

export const fullCommand = root.pipe(Command.withSubcommands([schema,init,skills,newDocument,showDocument,listDocuments,recover,config,taste,...(['use-case','roadmap'] as const).map(docsGroup),memory,issue,feedback,test,code,cache,docs,writing,concepts,check,lsp,trace,review,templates,diagnose,action,workspace,gitView,view,server,herdr]));
