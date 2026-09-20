import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { NodeRuntime } from "@effect/platform-node";
import { Effect } from "effect";

import { ConcordError, decode } from "../src/shared.js";
import {
  NeutralGovernanceMigrationPlanSchema,
  applyNeutralGovernanceMigration,
  prepareNeutralGovernanceMigration,
  recoverNeutralGovernanceMigration,
} from "./neutral-governance-migration.js";

const asError = (cause: unknown): Error => cause instanceof Error ? cause : new Error(String(cause));

function parseSuite(value: string): { readonly id: string; readonly root: string } {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) throw new ConcordError("MigrationOptionInvalid", `Expected --suite <id>=<root>, got ${value}`);
  return { id: value.slice(0, separator), root: value.slice(separator + 1) };
}

const main = Effect.gen(function*() {
  const { values } = parseArgs({ options: {
    root: { type: "string" },
    plan: { type: "string" },
    suite: { type: "string", multiple: true },
    "history-path": { type: "string" },
    "coordination-only": { type: "boolean" },
    apply: { type: "boolean" },
    recover: { type: "boolean" },
  } });
  if (values.apply === true && values.recover === true) throw new ConcordError("MigrationOptionInvalid", "--apply and --recover are mutually exclusive");
  if (values.recover === true) {
    if (values.root === undefined) throw new ConcordError("MigrationOptionMissing", "--root is required for recovery");
    yield* Effect.log(JSON.stringify(yield* recoverNeutralGovernanceMigration(resolve(values.root))));
    return;
  }
  if (values.plan === undefined) throw new ConcordError("MigrationOptionMissing", "--plan is required");
  const planPath = resolve(values.plan);
  if (values.apply === true) {
    const plan = yield* Effect.try({ try: () => decode(NeutralGovernanceMigrationPlanSchema, JSON.parse(readFileSync(planPath, "utf8")) as unknown, planPath), catch: asError });
    if (planPath.startsWith(`${plan.root}/`) || dirname(planPath) === plan.root) throw new ConcordError("MigrationUnsafePlanPath", "Save the reviewed plan outside the consumer repository");
    yield* Effect.log(JSON.stringify(yield* applyNeutralGovernanceMigration(plan)));
    return;
  }
  if (values.root === undefined) throw new ConcordError("MigrationOptionMissing", "Preparation requires --root and --plan");
  const coordinationOnly = values["coordination-only"] === true;
  if (!coordinationOnly && (values["history-path"] === undefined || values.suite === undefined)) throw new ConcordError("MigrationOptionMissing", "Governance preparation requires at least one --suite and --history-path; use --coordination-only to migrate private state without a repository profile");
  if (coordinationOnly && (values["history-path"] !== undefined || values.suite !== undefined)) throw new ConcordError("MigrationOptionInvalid", "--coordination-only cannot be combined with --suite or --history-path");
  const root = resolve(values.root);
  if (planPath.startsWith(`${root}/`) || dirname(planPath) === root) throw new ConcordError("MigrationUnsafePlanPath", "Save the reviewed plan outside the consumer repository");
  const plan = yield* prepareNeutralGovernanceMigration({
    root,
    mode: coordinationOnly ? "coordination-only" : "governance",
    ...(coordinationOnly ? {} : { suites: values.suite!.map(parseSuite), historyPath: values["history-path"]! }),
    generatedAt: new Date().toISOString(),
  });
  yield* Effect.try({ try: () => writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx", mode: 0o600 }), catch: asError });
  yield* Effect.log(JSON.stringify({ status: "prepared", plan: planPath, repositoryChanges: plan.repositoryChanges.length, stateFiles: plan.legacyState.files.length }));
});

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) NodeRuntime.runMain(main);
