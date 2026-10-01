import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import test, { type TestContext } from "node:test";
import { Effect, Result } from "effect";
import { NodeServices } from "@effect/platform-node";
import { compileTrace, compileTraceReport, findCaseIdConflicts } from "../dist/repository/docs/trace/compiler.js";

import { decodeCaseDeclarations, encodeCaseArchive } from "../dist/repository/docs/test-case/annotations.js";

const entry = resolve("dist/entry.js");
const owner = (fields: object) => `---\n${JSON.stringify({ format: "concord.document/v1", createdAt: "2026-09-14T00:00:00.000Z", ...fields })}\n---\n# Owner\n`;
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "concord-composition-report-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path: string, text: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  execFileSync("git", ["init", "-q", root]);
  write("concord.repository.json", JSON.stringify({ format: "concord.repository/v2", suites: [{ id: "suite", root: "suite" }], historyPath: "history.ts", policy: "concord.native-reliability/v1" }));
  write("docs/feature/x/README.md", owner({ kind: "feature", id: "x", title: "X" }));
  write("memory/problem.md", owner({ kind: "memory", id: "problem", title: "Problem", memoryKind: "problem", state: "open", epoch: 0, promotions: [], history: [] }));
  write("suite/good.ts", 'import { test } from "node:test";\n// @feature docs/feature/x/README.md\ntest("good", () => {});\n');
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"]);
  return { root, write, cli: (...args: string[]) => spawnSync(process.execPath, [entry, "repo", ...args], { cwd: root, encoding: "utf8" }) };
}

// @use-case docs/feature/neutral-project-governance/use-case/compose-repository-workflows.md
test("Trace report rejects whole bad files and keeps strict owner failures", async t => {
  const { root, write } = fixture(t);
  write("suite/mixed.ts", 'import { test } from "node:test";\n// @feature docs/feature/x/README.md\ntest("first", () => {});\n// @feature docs/feature/x/library.md\ntest("bad", () => {});\n');
  write("suite/missing.ts", 'import { test } from "node:test";\n// @feature docs/feature/x/README.md\ntest("rollback", () => {});\n// @feature docs/feature/missing/README.md\ntest("missing", () => {});\n');
  const run = <A, E>(effect: Effect.Effect<A, E, import("effect").FileSystem.FileSystem>) => Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));
  const report = await run(compileTraceReport(root));
  assert.equal(report.complete, false);
  assert.equal(report.findings.length, 2);
  assert.deepEqual(report.snapshot.tests.map(item => item.title), ["good"]);
  assert.equal(report.findings.find(f => f.path === "suite/mixed.ts")?.suggestion, "docs/feature/x/README.md");
  await assert.rejects(run(compileTrace(root)), /Feature package README/);
  write("memory/problem.md", owner({ kind: "memory", id: "problem", title: "Problem", memoryKind: "problem", state: "invalid", epoch: 0, promotions: [], history: [] }));
  await assert.rejects(run(compileTraceReport(root)), /TraceFormatError/);
});

// @use-case docs/feature/neutral-project-governance/use-case/compose-repository-workflows.md
test("built repo CLI reports incomplete reads, fails checks and writes, and emits one parse error", async t => {
  await Effect.runPromise(Effect.sync(() => {
    const { root, write, cli } = fixture(t);
    write("suite/bad.ts", "// @feature docs/feature/x/library.md\n");
    const list = cli("docs", "feature", "list", "--json");
    assert.equal(list.status, 0, list.stderr);
    const receipt = JSON.parse(list.stdout) as { complete: boolean; findings: { path: string; suggestion?: string }[] };
    assert.equal(receipt.complete, false);
    assert.equal(receipt.findings[0]?.path, "suite/bad.ts");
    assert.equal(receipt.findings[0]?.suggestion, "docs/feature/x/README.md");
    assert.equal(list.stderr, "");
    const human = cli("docs", "feature", "show", "x");
    assert.equal(human.status, 0, human.stderr);
    assert.match(human.stderr, /^warning: suite\/bad.ts: @feature must target/mu);
    for (const args of [["memory", "list"], ["feedback", "list"], ["docs", "test", "list"], ["docs", "trace"]]) {
      const result = cli(...args, "--json");
      assert.equal(result.status, 0, result.stderr);
      assert.equal((JSON.parse(result.stdout) as { complete: boolean }).complete, false);
    }
    for (const domain of ["memory", "feedback"]) {
      const checked = cli(domain, "check", "--json");
      assert.equal(checked.status, 1, checked.stderr);
      const check = JSON.parse(checked.stdout) as { ok: boolean; complete: boolean; violations: string[]; incomplete: { path: string }[] };
      assert.equal(check.ok, false);
      assert.equal(check.complete, false);
      assert.deepEqual(check.violations, []);
      assert.equal(check.incomplete[0]?.path, "suite/bad.ts");
    }
    const before = readFileSync(join(root, "memory/problem.md"), "utf8");
    const writeResult = cli("memory", "resolve", "problem", "--kind", "fixed", "--reason", "ready", "--json");
    assert.equal(writeResult.status, 1);
    const failure = JSON.parse(writeResult.stderr) as { error: string; details: { findings: unknown[] } };
    assert.equal(failure.error, "TraceIncomplete");
    assert.equal(failure.details.findings.length, 1);
    assert.equal(readFileSync(join(root, "memory/problem.md"), "utf8"), before);
    assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" }).trim(), "?? suite/bad.ts");
    const unknown = cli("nosuch");
    assert.equal(unknown.status, 1);
    assert.equal(unknown.stdout, "");
    assert.equal(unknown.stderr, 'UnknownSubcommand: "nosuch" for "concord-repo"; run concord-repo --help\n');
    const parseError = cli("memory", "show");
    assert.equal(parseError.status, 1);
    assert.equal(parseError.stdout, "");
    assert.equal(parseError.stderr.trim().split("\n").length, 1);
    assert.match(parseError.stderr, /^InvalidInput:/);
    assert.doesNotMatch(parseError.stderr, /ShowHelp/);
    const jsonParseError = cli("memory", "show", "--json");
    assert.equal(jsonParseError.status, 1);
    assert.equal(jsonParseError.stderr.trim().split("\n").length, 1);
    assert.equal(JSON.parse(jsonParseError.stderr).error, "InvalidInput");
    const jsonUnknown = cli("nosuch", "--json");
    assert.equal(jsonUnknown.status, 1);
    assert.equal(jsonUnknown.stdout, "");
    assert.equal(jsonUnknown.stderr.trim().split("\n").length, 1);
    assert.deepEqual(JSON.parse(jsonUnknown.stderr).details, { name: "nosuch", parent: "concord-repo" });
    const relation = cli("docs", "test", "issue", "add", "suite/good.ts#neref_" + "0".repeat(32), "--url", "https://github.com/o/r/issues/1", "--provenance", "direct", "--json");
    assert.equal(relation.status, 1);
    assert.equal(JSON.parse(relation.stderr).error, "TraceIncomplete");
    write("body.md", "# Created\nBody\n");
    const created = cli("memory", "add", "created", "--title", "Created", "--kind", "note", "--body", "body.md", "--json");
    assert.equal(created.status, 0, created.stderr);
    assert.match(readFileSync(join(root, "memory/created.md"), "utf8"), /Created/);
    const issue = (...args: string[]) => spawnSync(process.execPath, [entry, ...args, "--json"], { cwd: root, encoding: "utf8" });
    const initialized = issue("init");
    assert.equal(initialized.status, 0, initialized.stderr);
    const addedIssue = issue("issue", "create", "observation", "--title", "Observation");
    assert.equal(addedIssue.status, 0, addedIssue.stderr);
    const closedIssue = issue("issue", "close", "observation", "--reason", "Reviewed");
    assert.equal(closedIssue.status, 0, closedIssue.stderr);
  }));
});

// @use-case docs/feature/neutral-project-governance/use-case/compose-repository-workflows.md
test("JavaScript consumer composes the same Memory and Feedback command contributions", async t => {
  await Effect.runPromise(Effect.sync(() => {
    const { root, write, cli } = fixture(t);
    const url = (path: string) => JSON.stringify(pathToFileURL(resolve(path)).href);
    // Explicit JavaScript-consumer compatibility fixture; implementation remains TypeScript.
    write("host.mjs", `import { Command } from ${url("node_modules/effect/dist/unstable/cli/index.js")};
import { Effect, Layer } from ${url("node_modules/effect/dist/index.js")};
import { NodeRuntime, NodeServices } from ${url("node_modules/@effect/platform-node/dist/index.js")};
import { memoryCliContribution, NodeMemoryStoreLive } from ${url("dist/repository/memory/index.js")};
import { feedbackCliContribution, NodeFeedbackStoreLive } from ${url("dist/repository/feedback/index.js")};
import { runComposedCli, deliverTerminal } from ${url("dist/repository/cli-support.js")};
const root = Command.make("host").pipe(Command.withSubcommands([memoryCliContribution.makeCommand(deliverTerminal), feedbackCliContribution.makeCommand(deliverTerminal)]));
runComposedCli(root, { version: "2" }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NodeMemoryStoreLive(process.cwd()), NodeFeedbackStoreLive(process.cwd()))), NodeRuntime.runMain);
`);
    const host = (...args: string[]) => spawnSync(process.execPath, [join(root, "host.mjs"), ...args], { cwd: root, encoding: "utf8" });
    for (const domain of ["memory", "feedback"]) {
      const actual = host(domain, "--help");
      const expected = cli(domain, "--help");
      assert.equal(actual.status, 0, actual.stderr);
      assert.equal(actual.stdout.replaceAll("host", "concord-repo"), expected.stdout);
      const implicit = host(domain);
      assert.equal(implicit.status, 0, implicit.stderr);
      assert.equal(implicit.stderr, "");
      assert.equal(implicit.stdout, actual.stdout);
      const repoImplicit = cli(domain);
      assert.equal(repoImplicit.status, 0, repoImplicit.stderr);
      assert.equal(repoImplicit.stdout, expected.stdout);
    }
    const unknown = host("memory", "nosuch");
    assert.equal(unknown.status, 1);
    assert.equal(unknown.stdout, "");
    assert.equal(unknown.stderr, 'UnknownSubcommand: "nosuch" for "host memory"; run host memory --help\n');
    const jsonUnknown = host("memory", "nosuch", "--json");
    assert.equal(jsonUnknown.status, 1);
    assert.equal(jsonUnknown.stderr.trim().split("\n").length, 1);
    assert.deepEqual(JSON.parse(jsonUnknown.stderr).details, { name: "nosuch", parent: "host memory" });
    const parse = host("memory", "show", "--json");
    assert.equal(parse.status, 1);
    assert.equal(JSON.parse(parse.stderr).error, "InvalidInput");
    // Exercise the runner itself with an undeclared exception at the host boundary.
    write("defect.mjs", `import { Command } from ${url("node_modules/effect/dist/unstable/cli/index.js")};
import { Effect } from ${url("node_modules/effect/dist/index.js")};
import { NodeRuntime, NodeServices } from ${url("node_modules/@effect/platform-node/dist/index.js")};
import { runComposedCli } from ${url("dist/repository/cli-support.js")};
const command = Command.make("defect", { json: (await import( ${url("node_modules/effect/dist/unstable/cli/index.js")})).Flag.boolean("json").pipe((await import( ${url("node_modules/effect/dist/unstable/cli/index.js")})).Flag.withDefault(false)) }, () => Effect.die(new Error(process.env.TEST_SECRET)));
runComposedCli(command, { version: "2" }).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);`);
    for (const args of [[], ["--json"]]) {
      const failed = spawnSync(process.execPath, [join(root, "defect.mjs"), ...args], { cwd: root, encoding: "utf8", env: { ...process.env, TEST_SECRET: "must-never-appear" } });
      assert.equal(failed.status, 1);
      assert.equal(failed.stdout, "");
      assert.equal(failed.stderr.trim().split("\n").length, 1);
      assert.match(failed.stderr, /RepositoryToolError/);
      assert.doesNotMatch(failed.stderr, /must-never-appear/);
    }
  }));
});

// @use-case docs/feature/neutral-project-governance/use-case/compose-repository-workflows.md
test("case-ID conflict grouping symmetrically excludes every declaration owner", () => {
  const decode = (path: string) => {
    const result = decodeCaseDeclarations(path, 'import { test } from "node:test";\n// @feature docs/feature/x/README.md\ntest("same", () => {});\n');
    assert.ok(Result.isSuccess(result));
    return result.success[0]!;
  };
  const left = decode("suite/a.ts");
  const right = decode("suite/b.ts");
  assert.notEqual(left.caseId, right.caseId); // Public derivation includes the declaration path.
  // Feed a defensive collision into the actual grouping algorithm; do not fake ID derivation.
  const collision = { ...right, caseId: left.caseId };
  const forward = findCaseIdConflicts([left, collision], "history.ts", []);
  assert.deepEqual(forward, findCaseIdConflicts([collision, left], "history.ts", []));
  assert.deepEqual([...forward.keys()], ["suite/a.ts", "suite/b.ts"]);
  assert.deepEqual(forward.get("suite/a.ts")?.[0]?.conflictsWith, ["suite/b.ts"]);
  assert.deepEqual(forward.get("suite/b.ts")?.[0]?.conflictsWith, ["suite/a.ts"]);
});

// @use-case docs/feature/neutral-project-governance/use-case/compose-repository-workflows.md
test("built CLI isolates tombstone and regression conflicts and identifies excluded cases", async t => {
  await Effect.runPromise(Effect.sync(() => {
    const { root, write, cli } = fixture(t);
    const source = 'import { test } from "node:test";\n// @feature docs/feature/x/README.md\ntest("retired", () => {});\n// @feature docs/feature/x/README.md\ntest("sibling", () => {});\n';
    write("suite/retired.ts", source);
    const decoded = decodeCaseDeclarations("suite/retired.ts", source);
    assert.ok(Result.isSuccess(decoded));
    const declaration = decoded.success[0]!;
    write("history.ts", encodeCaseArchive({ history: [], tombstones: [{ testFile: declaration.testFile, event: {
      caseId: declaration.caseId, lastSelector: `${declaration.testFile}#${declaration.caseId}`,
      lastRelation: { contract: "docs/feature/x/README.md", contractKind: "feature", regressions: [], issues: [] },
      retiredAtCommit: "0".repeat(40), transactionId: "netxn_fixture", reason: "retired",
    } }] }));
    write("suite/regression.ts", 'import { test } from "node:test";\n// @feature docs/feature/x/README.md\n// @regression memory/missing.md\ntest("missing", () => {});\n');
    write("memory/note.md", owner({ kind: "memory", id: "note", title: "Note", memoryKind: "note", state: "captured", epoch: 0, promotions: [], history: [] }));
    write("suite/note.ts", 'import { test } from "node:test";\n// @feature docs/feature/x/README.md\n// @regression memory/note.md\ntest("note", () => {});\n');
    const listed = cli("docs", "test", "list", "--json");
    assert.equal(listed.status, 0, listed.stderr);
    const report = JSON.parse(listed.stdout) as { cases: { title: string }[]; findings: { code: string; path: string; conflictsWith?: string[] }[] };
    assert.equal(report.cases.length, 1);
    assert.equal(report.findings.length, 3);
    assert.deepEqual(report.findings.find(f => f.path === "suite/retired.ts")?.conflictsWith, ["history.ts"]);
    assert.equal(report.findings.filter(f => f.code === "CaseRegressionInvalid").length, 2);
    for (const declaration of decoded.success) {
      const excluded = cli("docs", "test", "show", `${declaration.testFile}#${declaration.caseId}`, "--json");
      assert.equal(excluded.status, 1);
      assert.equal(excluded.stdout, "");
      const error = JSON.parse(excluded.stderr) as { error: string; details: { findings: { path: string }[] } };
      assert.equal(error.error, "CaseExcluded");
      assert.equal(error.details.findings[0]?.path, "suite/retired.ts");
    }
    const before = readFileSync(join(root, "memory/problem.md"), "utf8");
    const incompleteWrite = cli("memory", "resolve", "problem", "--kind", "fixed", "--reason", "fixed", "--json");
    assert.equal(incompleteWrite.status, 1);
    assert.equal(JSON.parse(incompleteWrite.stderr).details.findings.length, 3);
    assert.equal(readFileSync(join(root, "memory/problem.md"), "utf8"), before);
    const archive = readFileSync(join(root, "history.ts"), "utf8");
    write("history.ts", archive + archive);
    const duplicateHistory = cli("docs", "test", "list", "--json");
    assert.equal(duplicateHistory.status, 1);
    assert.equal(JSON.parse(duplicateHistory.stderr).error, "TraceFormatError");
    assert.match(duplicateHistory.stderr, /duplicate tombstones/);
    write("history.ts", "// @concord-tombstone invalid JSON\n");
    const invalidHistory = cli("docs", "test", "list", "--json");
    assert.equal(invalidHistory.status, 1);
    assert.equal(JSON.parse(invalidHistory.stderr).error, "TraceFormatError");
  }));
});
