import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";

import { compileTrace } from "../dist/repository/docs/trace/compiler.js";
import { createFeatureAt, addFeaturePageAt, setFeaturePageAt } from "../dist/repository/docs/feature-structure.js";
import { createUseCaseAt } from "../dist/repository/docs/use-case/domain.js";
import { decodeDesignReadme, encodeDecidedDesignReadme } from "../dist/repository/docs/design/codec.js";
import { MemoryRepository } from '../dist/repository/memory/repository.js';
import { FeedbackRepository } from '../dist/repository/feedback/repository.js';
import { leafOwnerSelection, assertSameLeafSelection } from '../dist/repository/document-owners.js';
import { traceDigest } from '../dist/repository/docs/trace/relation-mutation.js';
import { MemoryStore, NodeMemoryStoreLive } from '../dist/repository/memory/services.js';

function write(root: string, path: string, source: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "concord-repository-document-format-"));
  execFileSync("git", ["init", "-q", root]);
  for (const directory of ["docs", "docs/issues", "e2e", "feedback", "memory"]) mkdirSync(join(root, directory), { recursive: true });
  write(root, "concord.repository.json", JSON.stringify({ format: 'concord.repository/v2', suites: [{ id: 'suite', root: 'e2e' }], historyPath: 'test-history.ts', policy: 'concord.native-reliability/v1' }));
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

// @use-case docs/feature/local-sdlc/use-case/plan-and-adopt-contracts.md
test('advanced governance shares Unicode paths, metadata identity and historical classification', async () => {
  const root = fixture();
  try {
    renameSync(join(root, 'docs/feature/migrated'), join(root, 'docs/feature/中文功能'));
    const flow = readFileSync(join(root, 'docs/feature/中文功能/use-case/flow.md'), 'utf8').replaceAll('docs/feature/migrated', 'docs/feature/中文功能');
    rmSync(join(root, 'docs/feature/中文功能/use-case/flow.md'));
    write(root, 'docs/feature/中文功能/use-case/中文路径.md', flow);
    const design = readFileSync(join(root, 'docs/design/storage/README.md'), 'utf8').replaceAll('docs/feature/migrated', 'docs/feature/中文功能');
    write(root, 'docs/design/storage/README.md', design);
    write(root, 'memory/design/README.md', design);
    renameSync(join(root, 'memory/problem.md'), join(root, 'memory/中文问题.md'));
    renameSync(join(root, 'docs/issues/issue.md'), join(root, 'docs/issues/中文观察.md'));
    const snapshot = await run(compileTrace(root).pipe(Effect.provide(NodeServices.layer)));
    assert.equal(snapshot.nodes.find(node => node.id === 'flow')?.path, 'docs/feature/中文功能/use-case/中文路径.md');
    assert.deepEqual(snapshot.memory.map(owner => owner.path), ['memory/中文问题.md']);
    assert.equal(snapshot.feedback[0]?.path, 'docs/issues/中文观察.md');
    assert.equal(new MemoryRepository(root).ownerPath('problem'), 'memory/中文问题.md');
    assert.equal(new FeedbackRepository({ root }).ownerPath('issue'), 'docs/issues/中文观察.md');
    const initialMemory = new MemoryRepository(root).read('problem').metadata;
    const receipt = await run(Effect.gen(function*() {
      const store = yield* MemoryStore;
      return yield* store.resolve('problem', { kind: 'not-a-bug', reason: 'Reviewed current owner' }, false);
    }).pipe(Effect.provide(NodeMemoryStoreLive(root)), Effect.provide(NodeServices.layer)));
    assert.equal(receipt.owner, 'memory/中文问题.md');
    assert.equal(new MemoryRepository(root).read('problem').metadata.state, 'resolved');
    await run(createUseCaseAt(root, { slug: '新增动作', parent: 'migrated', title: '新增动作', body: '# 新增动作\n', dryRun: false }).pipe(Effect.provide(NodeServices.layer)));
    assert.match(readFileSync(join(root, 'docs/feature/中文功能/use-case/新增动作.md'), 'utf8'), /feature: docs\/feature\/中文功能\/README.md/u);
    write(root, 'docs/_template/feature-design/README.md', '# <功能或候选名>\n');
    await assert.rejects(run(createFeatureAt(root, { slug: 'migrated', title: 'Duplicate', pages: [], dryRun: false }).pipe(Effect.provide(NodeServices.layer))), /already exists/u);
    write(root, 'docs/_template/feature-design/library.md', '# <功能或候选名> library\n');
    const pageAdded = await run(addFeaturePageAt(root, { feature: 'migrated', page: 'library', dryRun: false }).pipe(Effect.provide(NodeServices.layer)));
    assert.equal(pageAdded.feature.slug, 'migrated');
    const pagePath = 'docs/feature/中文功能/library.md';
    await run(setFeaturePageAt(root, { feature: 'migrated', page: 'library', body: '# Updated', expectedPreimageDigest: traceDigest(readFileSync(join(root, pagePath), 'utf8')), dryRun: false }).pipe(Effect.provide(NodeServices.layer)));
    assert.equal(readFileSync(join(root, pagePath), 'utf8'), '# Updated\n');
    const frozen = leafOwnerSelection(root, 'memory', 'problem');
    renameSync(join(root, 'memory/中文问题.md'), join(root, 'memory/移动问题.md'));
    assert.throws(() => assertSameLeafSelection(root, 'memory', 'problem', frozen), /changed identity, path, or content/u);
    write(root, 'memory/重名问题.md', readFileSync(join(root, 'memory/移动问题.md'), 'utf8'));
    assert.throws(() => new MemoryRepository(root).read('problem'), /ambiguous/u);
    assert.equal(new MemoryRepository(root).read('memory/移动问题.md').metadata.id, 'problem');
    const exact = leafOwnerSelection(root, 'memory', 'memory/移动问题.md');
    write(root, 'memory/移动问题.md', readFileSync(join(root, 'memory/移动问题.md'), 'utf8').replace('id: problem', 'id: replaced'));
    assert.throws(() => assertSameLeafSelection(root, 'memory', 'memory/移动问题.md', exact), /changed identity, path, or content/u);
    const created = await run(Effect.gen(function*() {
      const store = yield* MemoryStore;
      return yield* store.create(initialMemory, '# Independent path identity\n', false);
    }).pipe(Effect.provide(NodeMemoryStoreLive(root)), Effect.provide(NodeServices.layer)));
    assert.equal(created.owner, 'memory/problem.md');
    assert.throws(() => new MemoryRepository(root).read('problem'), /ambiguous/u);
    assert.equal(new MemoryRepository(root).read('memory/problem.md').metadata.id, 'problem');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

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
