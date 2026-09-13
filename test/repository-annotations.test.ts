import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Effect, Result } from "effect";

import { decodeAnnotatedCases, locateSupportedTestDeclarations, replaceCaseAnnotations, stripManagedCaseAnnotations } from "../dist/repository/docs/test-case/annotations.js";
import { buildRepositorySourceIdentity, decodeRepositorySourceIdentityV2, decodeSourceProjectionV1, projectRepositorySources, sameRepositorySourceIdentity } from "../dist/repository/source-identity.js";

// @concord-case repository-profile-annotation-bindings
// @concord-contract docs/feature/local-sdlc/use-case/load-compatible-repository-profile.md
test("repository annotations bind helpers and supported runner call shapes", () => Effect.runPromise(Effect.sync(() => {
  const source = `import { test, it } from "vitest";
// @concord-case necase_0123456789ABCDEF
// @concord-owner docs/engineering/testing/e2e/runner.md#owner
// @concord-regression memory/problem.md
// @concord-test-file e2e/runner/test/native.test.ts
test.concurrent("one [necase_0123456789ABCDEF]", () => {});
// @concord-case necase_1123456789ABCDEF
// @concord-owner docs/engineering/testing/e2e/runner.md#owner
it("two [necase_1123456789ABCDEF]", () => {});
// @concord-case necase_2123456789ABCDEF
// @concord-owner docs/engineering/testing/e2e/runner.md#owner
test.skipIf(true)("three [necase_2123456789ABCDEF]", () => {});
`;
  const decoded = decodeAnnotatedCases("e2e/runner/test/helper.scenarios.ts", source);
  assert.equal(Result.isSuccess(decoded), true);
  if (Result.isSuccess(decoded)) {
    assert.equal(decoded.success.length, 3);
    assert.equal(decoded.success[0]!.testFile, "e2e/runner/test/native.test.ts");
  }
})));

// @concord-case repository-profile-annotation-rejections
// @concord-contract docs/feature/local-sdlc/use-case/load-compatible-repository-profile.md
test("repository annotations reject dangling and trailing comments but retain pseudo comments", () => Effect.runPromise(Effect.sync(() => {
  const dangling = `import { test } from "vitest";\n// @concord-case necase_0123456789ABCDEF\nconst nope = 1;\n`;
  assert.equal(Result.isFailure(decodeAnnotatedCases("e2e/a.test.ts", dangling)), true);
  const trailing = `import { test } from "vitest";\ntest("plain", () => {}); // @concord-owner docs/x.md#x\n`;
  assert.equal(Result.isFailure(decodeAnnotatedCases("e2e/a.test.ts", trailing)), true);
  const pseudo = "import { test } from 'vitest';\nconst a = '// @concord-owner fake';\nconst b = `// @concord-case ${String.raw`necase_0123456789ABCDEF`}`;\n";
  const projected = stripManagedCaseAnnotations("e2e/a.test.ts", pseudo);
  assert.equal(Result.isSuccess(projected), true);
  if (Result.isSuccess(projected)) assert.equal(projected.success, pseudo);
  const unsupported = `import { test } from "vitest";\n// @concord-case necase_0123456789ABCDEF\n// @concord-owner docs/x.md#x\ntest.extend("case [necase_0123456789ABCDEF]", () => {});\n`;
  assert.equal(Result.isFailure(decodeAnnotatedCases("e2e/a.test.ts", unsupported)), true, "test.extend is not a test declaration");
  assert.equal(locateSupportedTestDeclarations("e2e/a.test.ts", unsupported).length, 0);
  const shadowed = `import { test } from "vitest";\nfunction register(test: (name: string, body: () => void) => void) { test("case [necase_0123456789ABCDEF]", () => {}); }\n`;
  assert.equal(locateSupportedTestDeclarations("e2e/a.test.ts", shadowed).length, 0, "shadowed imports are ambiguous and rejected");
})));

// @concord-case repository-profile-source-projection
// @concord-contract docs/feature/local-sdlc/use-case/load-compatible-repository-profile.md
test("source projection ignores relation annotation changes and detects code or path changes", () => Effect.runPromise(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(), "concord-source-projection-"));
  try {
    mkdirSync(join(root, "test"), { recursive: true });
    const path = join(root, "test/example.test.ts");
    const source = (owner: string, body: string) => `import { test } from "vitest";\n// @concord-case necase_0123456789ABCDEF\n// @concord-owner ${owner}\ntest("case [necase_0123456789ABCDEF]", () => { ${body} });\n`;
    writeFileSync(path, source("docs/a.md#x", "assert(true)"));
    const first = projectRepositorySources(root);
    writeFileSync(path, source("docs/b.md#y", "assert(true)"));
    const relationOnly = projectRepositorySources(root);
    assert.equal(relationOnly.digest, first.digest);
    assert.notEqual(relationOnly.files[0]!.rawSha256, first.files[0]!.rawSha256);
    const withOrdinary = source("docs/b.md#y", "assert(true)").replace("// @concord-owner", "// ordinary assertion rationale\n// @concord-owner");
    writeFileSync(path, withOrdinary);
    const ordinary = projectRepositorySources(root);
    assert.notEqual(ordinary.digest, first.digest, "ordinary comments remain code-projection bytes");
    const decoded = decodeAnnotatedCases("test/example.test.ts", withOrdinary);
    assert.equal(Result.isSuccess(decoded), true);
    if (Result.isSuccess(decoded)) {
      const rewritten = replaceCaseAnnotations(withOrdinary, decoded.success[0]!, { owner: "docs/c.md#z", regressions: ["memory/fixed.md"], issues: [] });
      assert.match(rewritten, /ordinary assertion rationale/u, "relation mutation must preserve ordinary comments between managed annotations");
      assert.match(rewritten, /@concord-regression memory\/fixed\.md/u);
      const beforeCode = stripManagedCaseAnnotations("test/example.test.ts", withOrdinary);
      const afterCode = stripManagedCaseAnnotations("test/example.test.ts", rewritten);
      assert.equal(Result.isSuccess(beforeCode), true);
      assert.equal(Result.isSuccess(afterCode), true);
      if (Result.isSuccess(beforeCode) && Result.isSuccess(afterCode)) assert.equal(afterCode.success, beforeCode.success, "actual relation rewrite must not self-invalidate the code projection");
    }
    writeFileSync(path, source("docs/b.md#y", "assert(false)"));
    assert.notEqual(projectRepositorySources(root).digest, first.digest);
    writeFileSync(join(root, "extra.ts"), "export const extra = true;\n");
    assert.notEqual(projectRepositorySources(root).digest, first.digest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
})));

// @concord-case repository-profile-source-bindings
// @concord-contract docs/feature/local-sdlc/use-case/load-compatible-repository-profile.md
test("source identity binds helper code and whole owner and contract documents", () => Effect.runPromise(Effect.sync(() => {
  const root = mkdtempSync(join(tmpdir(), "concord-source-identity-"));
  try {
    const project = join(root, "e2e/fixture");
    mkdirSync(join(project, "test"), { recursive: true });
    mkdirSync(join(root, "docs/engineering/testing/e2e"), { recursive: true });
    mkdirSync(join(root, "docs/feature/fixture/use-case"), { recursive: true });
    writeFileSync(join(project, "project.json"), "{}\n");
    writeFileSync(join(root, "docs/engineering/testing/e2e/fixture.md"), "# Fixture owner\n");
    writeFileSync(join(root, "docs/feature/fixture/use-case/run.md"), "# Run fixture\n");
    writeFileSync(join(project, "test/native.test.ts"), "import './helper.scenarios.js';\n");
    writeFileSync(join(project, "test/helper.scenarios.ts"), `import { test } from "vitest";
// @concord-case necase_0123456789ABCDEF
// @concord-owner docs/engineering/testing/e2e/fixture.md#fixture
// @concord-test-file e2e/fixture/test/native.test.ts
test("fixture [necase_0123456789ABCDEF]", () => assert.equal(1, 1));
`);
    const identity = () => buildRepositorySourceIdentity({
      repositoryRoot: root,
      projectRoot: project,
      caseId: "necase_0123456789ABCDEF",
      nativeTestFile: "e2e/fixture/test/native.test.ts",
      ownerRef: "docs/engineering/testing/e2e/fixture.md#fixture",
      contractRef: "docs/feature/fixture/use-case/run.md",
    });
    const signed = identity();
    assert.deepEqual(decodeRepositorySourceIdentityV2(signed), signed);
    assert.throws(() => decodeRepositorySourceIdentityV2({ ...signed, unknown: true }), /SourceIdentityInvalid/u);
    assert.throws(() => decodeSourceProjectionV1({ ...signed.projection, files: [...signed.projection.files].reverse() }), /strictly sorted|digest mismatch/u);
    assert.throws(() => decodeSourceProjectionV1({ ...signed.projection, digest: "0".repeat(64) }), /digest mismatch/u);
    writeFileSync(join(project, "test/helper.scenarios.ts"), readFileSync(join(project, "test/helper.scenarios.ts"), "utf8").replace("assert.equal(1, 1)", "assert.equal(2, 2)"));
    assert.equal(sameRepositorySourceIdentity(signed, identity()), false, "helper assertion drift must invalidate evidence");
    writeFileSync(join(project, "test/helper.scenarios.ts"), readFileSync(join(project, "test/helper.scenarios.ts"), "utf8").replace("assert.equal(2, 2)", "assert.equal(1, 1)"));
    writeFileSync(join(root, "docs/engineering/testing/e2e/fixture.md"), "# Fixture owner changed\n");
    assert.equal(sameRepositorySourceIdentity(signed, identity()), false, "owner document drift must invalidate evidence");
    writeFileSync(join(root, "docs/engineering/testing/e2e/fixture.md"), "# Fixture owner\n");
    writeFileSync(join(root, "docs/feature/fixture/use-case/run.md"), "# Run fixture changed\n");
    assert.equal(sameRepositorySourceIdentity(signed, identity()), false, "contract document drift must invalidate evidence");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
})));
