#!/usr/bin/env -S npx tsx
import { Command } from "effect/unstable/cli";
import * as FileSystem from "effect/FileSystem";
import { Effect } from "effect";
export declare const e2eCommand: Command.Command<"e2e", {}, {}, unknown, import("effect/Scope").Scope | (FileSystem.FileSystem | import("./owned-process.ts").OwnedProcess)>;
export declare const program: Effect.Effect<void, unknown, never>;
