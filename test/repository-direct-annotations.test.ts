import assert from "node:assert/strict";
import test from "node:test";
import { Result } from "effect";

import { decodeAnnotatedCases, stripManagedCaseAnnotations, replaceCaseAnnotations } from "../dist/repository/docs/test-case/annotations.js";

const header = (relation: string, title: string) => `import { test } from "node:test";\n\n// ${relation}\n// @regression memory/problem.md\n// @test-file test/native.test.ts\ntest(${JSON.stringify(title)}, () => {});\n`;

// @use-case docs/feature/local-sdlc/use-case/load-compatible-repository-profile.md
test("parses feature and use-case direct annotations with derived identity", () => {
  const feature = decodeAnnotatedCases("test/native.test.ts", header("@feature docs/feature/checkout/README.md", "charges card"));
  assert.equal(Result.isSuccess(feature), true);
  if (Result.isSuccess(feature)) assert.equal(feature.success[0]?.contractKind, "feature");

  const useCase = decodeAnnotatedCases("test/native.test.ts", header("@use-case docs/feature/checkout/use-case/charge-card.md", "charges card"));
  assert.equal(Result.isSuccess(useCase), true);
  if (Result.isSuccess(useCase)) assert.equal(useCase.success[0]?.contractKind, "use-case");
});

// @use-case docs/feature/local-sdlc/use-case/load-compatible-repository-profile.md
test("rejects ambiguous titles and strips only relationship annotations", () => {
  const source = `import { test } from "node:test";\n// @use-case docs/feature/checkout/use-case/charge-card.md\ntest("same", () => {});\ntest("same", () => {});\n`;
  assert.equal(Result.isFailure(decodeAnnotatedCases("test/native.test.ts", source)), true);

  const projected = stripManagedCaseAnnotations("test/native.test.ts", header("@use-case docs/feature/checkout/use-case/charge-card.md", "charges card"));
  assert.equal(Result.isSuccess(projected), true);
  if (Result.isSuccess(projected)) {
    assert.match(projected.success, /@test-file test\/native\.test\.ts/u);
    assert.doesNotMatch(projected.success, /@feature|@regression/u);
  }
});

// @use-case docs/feature/local-sdlc/use-case/load-compatible-repository-profile.md
test("updating relations preserves the native mapping and code projection", () => {
  for (const mapping of ["", "// @test-file test/native.test.ts\n"]) {
    const source = `import { test } from "node:test";\n// @feature docs/feature/checkout/README.md\n${mapping}test("charges card", () => {});\n`;
    const decoded = decodeAnnotatedCases("test/native.test.ts", source);
    assert.equal(Result.isSuccess(decoded), true);
    if (Result.isFailure(decoded)) assert.fail(decoded.failure.message);
    const item = decoded.success[0]!;
    const changed = replaceCaseAnnotations(source, item, { contract: item.contract, contractKind: item.contractKind, regressions: ["memory/problem.md"], issues: [] });
    assert.equal(changed.includes("@test-file"), mapping !== "");
    assert.deepEqual(stripManagedCaseAnnotations(item.declarationPath, changed), stripManagedCaseAnnotations(item.declarationPath, source));
  }
});
