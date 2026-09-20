import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Effect, Result } from "effect";

import { decodeAnnotatedCases, locateSupportedTestDeclarations, stripManagedCaseAnnotations } from "../dist/repository/docs/test-case/annotations.js";
import { buildRepositorySourceIdentity, decodeRepositorySourceIdentityV4, decodeSourceProjectionV3, projectRepositorySources, projectExecutionSources, sameRepositorySourceIdentity } from "../dist/repository/source-identity.js";
import { deriveTestReference } from "../dist/test-reference.js";

// @use-case docs/feature/local-sdlc/use-case/load-compatible-repository-profile.md
test("repository annotations bind direct Feature and Use Case targets", () => Effect.runPromise(Effect.sync(() => {
  const path = "acceptance/runner/test/helper.scenarios.ts";
  const source = `import { test, it } from "vitest";
// @feature docs/feature/runner/README.md
// @regression memory/problem.md
test.concurrent("ordinary one", () => {});
// @use-case docs/feature/runner/use-case/run.md
it("ordinary two", () => {});
// @use-case docs/feature/runner/use-case/skip.md
test.skipIf(true)("ordinary three", () => {});
`;
  const decoded = decodeAnnotatedCases(path, source);
  assert.equal(Result.isSuccess(decoded), true);
  if (Result.isSuccess(decoded)) {
    assert.equal(decoded.success.length, 3);
    assert.equal(decoded.success[0]!.caseId, deriveTestReference(path, path, "ordinary one"));
    assert.equal(decoded.success[0]!.contract, "docs/feature/runner/README.md");
  }
  assert.equal(locateSupportedTestDeclarations(path, source).length, 3);
})));

// @use-case docs/feature/local-sdlc/use-case/load-compatible-repository-profile.md
test("direct-contract source identity binds target content and code projection", () => Effect.runPromise(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(), "concord-source-identity-"));
  try {
    const project = join(root, "acceptance/fixture");
    const declarationPath = "acceptance/fixture/test/helper.scenarios.ts";
    const contract = "docs/feature/fixture/use-case/run.md";
    mkdirSync(join(project, "test"), { recursive: true });
    mkdirSync(join(root, "docs/feature/fixture/use-case"), { recursive: true });
    writeFileSync(join(root, "concord.repository.json"), JSON.stringify({
      format: "concord.repository/v2",
      suites: [{ id: "fixture", root: "acceptance/fixture" }],
      historyPath: "acceptance/history.ts",
      policy: "concord.native-reliability/v1",
    }));
    writeFileSync(join(root, contract), "# Run fixture\n");
    const source = (title: string, body: string, target = contract) => `import { test } from "vitest";\n// @use-case ${target}\ntest("${title}", () => { ${body} });\n`;
    writeFileSync(join(project, "test/helper.scenarios.ts"), source("fixture", "assert.equal(1, 1)"));
    const caseId = deriveTestReference(declarationPath, declarationPath, "fixture");
    const build = (id = caseId, contractRef: string | undefined = contract) => buildRepositorySourceIdentity({ repositoryRoot: root, caseId: id, nativeTestFile: declarationPath, ...(contractRef === undefined ? {} : { contractRef }) });
    const signed = build();
    assert.deepEqual(decodeRepositorySourceIdentityV4(signed), signed);
    assert.deepEqual(decodeSourceProjectionV3(signed.projection), signed.projection);
    assert.equal(signed.binding.suiteId, "fixture");
    assert.equal(signed.binding.adapterSourceDigest, null);

    writeFileSync(join(root, contract), "# Run fixture changed\n");
    assert.equal(sameRepositorySourceIdentity(signed, build()), false, "contract content changes must invalidate identity");
    writeFileSync(join(root, contract), "# Run fixture\n");
    writeFileSync(join(project, "test/helper.scenarios.ts"), source("fixture", "assert.equal(2, 2)"));
    assert.equal(sameRepositorySourceIdentity(signed, build()), false, "source code changes must invalidate identity");
    writeFileSync(join(project, "test/helper.scenarios.ts"), source("renamed fixture", "assert.equal(1, 1)"));
    const renamedId = deriveTestReference(declarationPath, declarationPath, "renamed fixture");
    assert.equal(sameRepositorySourceIdentity(signed, build(renamedId)), false, "test title changes must invalidate derived identity");
    writeFileSync(join(project, "test/helper.scenarios.ts"), source("fixture", "assert.equal(1, 1)", "docs/feature/fixture/use-case/other.md"));
    writeFileSync(join(root, "docs/feature/fixture/use-case/other.md"), "# Other fixture\n");
    assert.equal(sameRepositorySourceIdentity(signed, build(caseId, "docs/feature/fixture/use-case/other.md")), false, "direct contract target changes must invalidate identity");
    writeFileSync(join(project, "test/helper.scenarios.ts"), source("fixture", "assert.equal(1, 1)"));
    writeFileSync(join(root, "adapter.ts"), "export default 'adapter-v1';\n");
    writeFileSync(join(root, "concord.repository.json"), JSON.stringify({
      format: "concord.repository/v2",
      suites: [{ id: "fixture", root: "acceptance/fixture" }],
      historyPath: "acceptance/history.ts",
      policy: "concord.native-reliability/v1",
      host: "adapter.ts",
    }));
    const adapterBound = build();
    assert.match(adapterBound.binding.adapterSourceDigest ?? "", /^sha256:[0-9a-f]{64}$/u);
    writeFileSync(join(root, "adapter.ts"), "export default 'adapter-v2';\n");
    assert.equal(sameRepositorySourceIdentity(adapterBound, build()), false, "adapter source drift must invalidate identity");
    const beforeConfigurationDrift = build();
    writeFileSync(join(root, "concord.repository.json"), `${readFileSync(join(root, "concord.repository.json"), "utf8")}\n`);
    assert.equal(sameRepositorySourceIdentity(beforeConfigurationDrift, build()), false, "configuration source drift must invalidate identity");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
})));

// @use-case docs/feature/local-sdlc/use-case/load-compatible-repository-profile.md
test("source projection preserves direct target annotations while detecting code changes", () => Effect.runPromise(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(), "concord-source-projection-"));
  try {
    mkdirSync(join(root, "acceptance/unit/test"), { recursive: true });
    writeFileSync(join(root, "concord.repository.json"), JSON.stringify({
      format: "concord.repository/v2",
      suites: [{ id: "unit", root: "acceptance/unit" }],
      historyPath: "acceptance/history.ts",
      policy: "concord.native-reliability/v1",
    }));
    const path = join(root, "acceptance/unit/test/example.test.ts");
    const source = (target: string, body: string) => `import { test } from "vitest";\n// @use-case ${target}\ntest("ordinary title", () => { ${body} });\n`;
    writeFileSync(path, source("docs/feature/a/use-case/x.md", "assert(true)"));
    const projected = stripManagedCaseAnnotations("test/example.test.ts", readFileSync(path, "utf8"));
    assert.equal(Result.isSuccess(projected), true);
    const first = projectRepositorySources(root, "acceptance/unit");
    writeFileSync(path, source("docs/feature/b/use-case/y.md", "assert(true)"));
    const relationOnly = projectRepositorySources(root, "acceptance/unit");
    assert.equal(relationOnly.digest, first.digest);
    assert.notEqual(relationOnly.files[0]!.rawSha256, first.files[0]!.rawSha256);
    writeFileSync(path, source("docs/feature/b/use-case/y.md", "assert(false)"));
    assert.notEqual(projectRepositorySources(root, "acceptance/unit").digest, first.digest);
    assert.equal(Result.isSuccess(projected), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
})));

// @use-case docs/feature/neutral-project-governance/use-case/adopt-neutral-governance.md
test("execution copies preserve the governed source projection without copying configuration", () => Effect.runPromise(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(), "concord-execution-projection-"));
  const copy = mkdtempSync(join(tmpdir(), "concord-execution-copy-"));
  try {
    mkdirSync(join(root, "acceptance/native"), { recursive: true });
    writeFileSync(join(root, "concord.repository.json"), JSON.stringify({ format: "concord.repository/v2", suites: [{ id: "native", root: "acceptance/native" }], historyPath: "history.ts", policy: "concord.native-reliability/v1" }));
    writeFileSync(join(root, "acceptance/native/value.ts"), "export const value = 1;\n");
    cpSync(join(root, "acceptance/native"), copy, { recursive: true });
    const governed = projectRepositorySources(root, "acceptance/native");
    assert.deepEqual(projectExecutionSources(copy, "acceptance/native"), governed);
    assert.throws(() => projectExecutionSources(copy, "../escape"));
    writeFileSync(join(copy, "value.ts"), "export const value = 2;\n");
    assert.notEqual(projectExecutionSources(copy, "acceptance/native").digest, governed.digest);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(copy, { recursive: true, force: true });
  }
})));
