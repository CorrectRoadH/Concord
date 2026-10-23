---
format: concord.document/v1
id: hawdb-v012-adoption-blockers
title: HawDB v0.12 的分支所有权与只读契约阻塞升级
createdAt: 2026-10-23T06:59:52.560Z
kind: memory
memoryKind: insight
state: superseded
epoch: 0
promotions: []
history:
  - at: 2026-10-23T08:25:05.885Z
    action: supersede
    reason: 授权架构适配后采用完整句柄协调锁、嵌套锁清理及逻辑只读边界；保留初次阻塞调查作为历史，不表示原问题在旧契约下自行消失
    ref: memory/hawdb-013-adoption.md
supersededBy: memory/hawdb-013-adoption.md
---

# HawDB v0.12 adoption blockers

Current Concord remains pinned to HawDB v0.3.0 (`1e9f76428be6649a18a6f99d75b0ccfef16bf545`). The requested upgrade was investigated against v0.12.0 (`c871b94cff8740e60ac2cb5b596c3c23317ec16f`), the latest stable release verified on 2026-10-23. No version change, tag or publication was performed.

Relevant upstream improvements include bounded indexed queries, query planning, resource accounting and checkpoint/write-liveness fixes. Vector/full-text search and Python/Go integrations are not needed by the existing Concord cache. A temporary bridge compiled after adapting fallible transaction acquisition. A small memory workload (1000 rows and 20 scans) took 180.0 ms on v0.3 and 148.8 ms on v0.12; this single sample is feasibility evidence, not an end-to-end performance claim.

## Independent review and reproduction

The parent wrote a concrete upgrade proposal, then commissioned read-only native Codex / GPT-6.1 Sol review through Herdr (`concord-hawdb012-review`). The review found three adoption blockers, independently checked by the parent:

1. v0.12 writable open publishes a branch-project selector and releases the root owner lock. Data runtime admission holds a branch lock instead. Concord's root-only clear guard is no longer sufficient. See upstream `src/api/mod.rs` around lines 1439–1474 and `crates/storage/src/store/immutable_root.rs` around 1223. A diagnostic-only addon bypassing Concord's directory inspector reproduced successful cross-process `flock --nonblock` on the root owner lock while a v0.12 read handle was active. This bypass was used only in /tmp, never shipped.
2. Read-only branch admission calls `mount_branch_runtime`, which removes/recreates runtime and writes manifest/WAL files. See `crates/storage/src/store/immutable_root.rs` around 1324 and 2713. The isolated probe observed 34 nested path identity/mtime changes during read-only access. Reading an untouched v0.3 legacy cache did preserve recursive paths and bytes; that does not prove the upgraded branch format is read-only. The repository test was strengthened from top-level hashes to recursive file names, inode, mtime and content digests.
3. Branch admission may fail at transaction acquisition. Mapping every acquisition error to unavailable loses the existing busy classification. Any adaptation must preserve the named lock-contention failure.

The engine also creates internal hard links for immutable checkpoint objects and recovery selectors. Current Concord correctly refuses these under its existing contract. A proposed complete dev/inode/link-count inventory could distinguish internal aliases from external aliases, with the owner lock still single-link and clear decrementing expected remaining link counts. Review found that approach viable, but it does not solve the ownership and read-only blockers; it was not adopted or implemented.

Source inspection of tags v0.4.0 through v0.11.0 found the same root-owner release during branch-project publication, so selecting an earlier newer stable version does not avoid the ownership change. Do not pin one without full protocol revalidation. New checkpoint files would also prevent the old bridge from reopening; downgrade would require a safe explicit clear with an adapted new CLI first.

## Delivery boundary

The provisional upgrade design was removed from adopted contract documentation. The original dependency pins, ABI, lock protocol and source ownership are unchanged. A user choice between preserving the current contracts and a separate architecture adaptation was requested; no contract weakening is implied by a version-update request. No upstream issue or external message was sent. The review pane was closed; no pane/tab/worktree remains.

Evidence locations: `/tmp/concord-hawdb-v012-upstream`, `/tmp/concord-hawdb-v012-probe`, `/tmp/concord-hawdb-upgrade-probe.ts`, `/tmp/concord-hawdb-v012-build.log`, `/tmp/concord-hawdb-v012-diagnostic-build.log`. These are local transient artifacts, not portable CI evidence. The original production dist remains on v0.3. Linux-only findings do not validate macOS.

Targeted validation: `pnpm exec tsc -p tsconfig.test.json` passed; the strengthened read-only native test passed. `pnpm exec vp run test:built test/hawdb-native.test.ts` passed 7 tests and skipped 2 test-hook-only cases because the unchanged production artifact does not contain test hooks. Log: `/tmp/concord-hawdb-upgrade-native-tests.log`. The prior full check had known selfhost implementation-relation and writing-cache parser failures; no new full-green claim is made.

Sources: https://github.com/nowledge-co/hawdb/releases/tag/v0.12.0 and https://github.com/nowledge-co/hawdb/blob/c871b94cff8740e60ac2cb5b596c3c23317ec16f/src/api/mod.rs and https://github.com/nowledge-co/hawdb/blob/c871b94cff8740e60ac2cb5b596c3c23317ec16f/crates/storage/src/store/immutable_root.rs
