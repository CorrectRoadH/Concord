import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";

import { compileTrace } from "../dist/repository/docs/trace/compiler.js";
import { createFeatureAt } from "../dist/repository/docs/feature-structure.js";
import { createUseCaseAt } from "../dist/repository/docs/use-case/domain.js";
import { decodeDesignReadme, encodeDecidedDesignReadme } from "../dist/repository/docs/design/codec.js";

function write(root: string, path: string, source: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "concord-repository-document-format-"));
  execFileSync("git", ["init", "-q", root]);
  for (const directory of ["docs", "docs/issues", "e2e", "feedback", "memory"]) mkdirSync(join(root, directory), { recursive: true });
  write(root, "memory/problem.md", "---\nformat: concord.document/v1\nid: problem\ntitle: Problem\ncreatedAt: 2026-09-14T00:00:00.000Z\nkind: memory\nmemoryKind: problem\nstate: open\nepoch: 0\npromotions: []\nhistory: []\n---\n\n# Problem\n");
  write(root, "docs/issues/issue.md", "---\nformat: concord.document/v1\nid: issue\ntitle: Issue\ncreatedAt: 2026-09-14T00:00:00.000Z\nkind: issue\nstate: draft\nmemoryRelations: []\nadoptions:\n  current: []\n  history: []\nhistory: []\n---\n\n# Issue\n");
  write(root, "docs/feature/migrated/README.md", `---
format: concord.document/v1
id: migrated
title: Migrated Feature
createdAt: 2026-09-14T00:00:00.000Z
kind: feature
---

# Migrated Feature
`);
  write(root, "docs/feature/migrated/use-case/README.md", "# Use Cases\n");
  write(root, "docs/feature/migrated/use-case/flow.md", `---
format: concord.document/v1
id: flow
title: Flow
createdAt: 2026-09-14T00:00:00.000Z
kind: use-case
feature: docs/feature/migrated/README.md
---

# Flow
`);
  write(root, "docs/design/storage/README.md", `---
format: concord.document/v1
id: storage
title: Storage
createdAt: 2026-09-14T00:00:00.000Z
kind: design
alternatives:
  - files
  - sqlite
decision:
  selected: files
  reason: Files preserve the authored source.
  at: 2026-09-14T00:00:00.000Z
  targets:
    - docs/feature/migrated/README.md
---

# Storage
<!-- concord.design-index/v1:start -->
<!-- concord.design-index/v1:end -->
`);
  write(root, "docs/design/storage/plans/files/README.md", "# Files\n");
  write(root, "docs/design/storage/plans/sqlite/README.md", "# SQLite\n");
  execFileSync("git", ["-C", root, "config", "user.name", "Concord fixture"]);
  execFileSync("git", ["-C", root, "config", "user.email", "fixture@example.invalid"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-qm", "Initial migrated documents"]);
  return root;
}

const run = <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> => Effect.runPromise(effect);

// @use-case docs/feature/local-sdlc/use-case/load-compatible-repository-profile.md
test("repository profile reads and writes concord.document/v1 owners", async () => {
  const root = fixture();
  try {
    const snapshot = await run(compileTrace(root).pipe(Effect.provide(NodeServices.layer)));
    assert.deepEqual(snapshot.nodes.filter((node) => node.kind !== "design-plan").map((node) => node.kind), ["design", "feature", "use-case"]);
    assert.equal(snapshot.nodes.filter((node) => node.kind === "design-plan").length, 2);
    assert.equal(snapshot.nodes.find((node) => node.kind === "design")?.relations.selectedPlan?.[0], "docs/design/storage/plans/files/README.md");
    assert.equal(snapshot.nodes.find((node) => node.kind === "use-case")?.relations.composes?.[0], "docs/feature/migrated/README.md");
    assert.deepEqual(snapshot.memory.map((item) => item.path), ["memory/problem.md"]);
    assert.deepEqual(snapshot.feedback.map((item) => item.path), ["docs/issues/issue.md"]);
    assert.equal([...snapshot.nodes].some((node) => JSON.stringify(node).includes("niceeval.docs-node/v1")), false);

    const decoded = decodeDesignReadme("docs/design/storage/README.md", readFileSync(join(root, "docs/design/storage/README.md"), "utf8"));
    const selectedPlan = "docs/design/storage/plans/sqlite/README.md" as Parameters<typeof encodeDecidedDesignReadme>[1];
    const decided = encodeDecidedDesignReadme(decoded, selectedPlan, decoded.body);
    assert.match(decided, /format: concord\.document\/v1/);
    assert.doesNotMatch(decided, /niceeval\.docs-node\/v1/);

    write(root, "docs/_template/feature-design/README.md", "# <功能或候选名>\n");
    await run(createFeatureAt(root, { slug: "written", title: "Written Feature", pages: [], dryRun: false }).pipe(Effect.provide(NodeServices.layer)));
    const feature = readFileSync(join(root, "docs/feature/written/README.md"), "utf8");
    assert.match(feature, /format: concord\.document\/v1/);
    assert.doesNotMatch(feature, /niceeval\.docs-node\/v1/);
    write(root, "docs/feature/written/use-case/README.md", "# Use Cases\n");
    await run(createUseCaseAt(root, { slug: "written-flow", parent: "written", title: "Written Flow", body: "# Written Flow\n", dryRun: false }).pipe(Effect.provide(NodeServices.layer)));
    const useCase = readFileSync(join(root, "docs/feature/written/use-case/written-flow.md"), "utf8");
    assert.match(useCase, /format: concord\.document\/v1/);
    assert.doesNotMatch(useCase, /niceeval\.docs-node\/v1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
