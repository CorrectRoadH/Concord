---
type: note
status: captured
---

# link-owned 宪法迁移与验收记录

## 签发与收据

- 签发工具：开工前把 HEAD `505238b` 用 `pnpm pack` 打包后安装到 `/tmp/concord-constitution/signer`，全程未更新，只用于 `test run` 与 `memory resolve`。
- 回归测试 `test/constitution-links.test.ts` 用 `@regression` 指向 [Problem](constitution-body-links-unchecked.md)。red `ccev_07fd688c51d2bb3076bc6682c7483d52`（check 返回 0，断言失败），green `ccev_33d2918629469279722867274d865bd4`。两次运行之间测试定义与契约摘要相同。
- Problem 以 fixed 关闭，证据级别 command。

## 迁移

- `concord --dry-run constitution migrate` 与临时副本上的完整预演结果一致后，对本仓库执行迁移：37 个文件，15 个条款，63 款，迁移 253 条 `constitutionRefs`。
- 契约示例中的 66 款与 248 条写于 2026-10-23，之后的修订与新 owner 改变了计数。
- 迁移验收：迁移前 253 个 `(owner, 条款)` 全部出现在迁移后同一 owner 的正文链接中，没有遗漏；迁移后共有 352 个 `(页面, 条款)`、364 处引用，另含既有正文链接与附页链接。
- 迁移后 `concord check` 通过。

## 宪法修订

- 总则新增条款写法，带 `general-*` ID。
- 宪法内的序号引用改为链接：`C-011` 第 1 款中的“第 6 款”、`C-012` 第 2 款中的 `C-015.3`、`C-015` 第 2 款中的 `C-007.3`。
- `C-008` 第 4 款改为按 ID 维护身份。
- 其它 Design 页面中指向当前条文的序号引用，逐处核对语义后改为款级链接。
- 下列序号文字按历史记录保留：test-adapters 的拟议条文与其裁决理由元数据（当时的第 3 款即现行第 6 款）、behavior-anchored 映射表的旧编号列与引用的拟议条文、constitution-structure 自身的问题描述与 CASES。

## 与 Plan 的偏差

- `document.metadata` action 带 `constitutionRefs` 时，按现有 action 严格解码返回 `InvalidData`；Plan 的接口表写的是 `InvalidInput`。Feature 契约只要求“严格拒绝额外字段”。统一 action 解码错误码会影响全部 action 的公开错误，未在本次变更中进行。

## 测试运行

- 全量 `node --test --test-concurrency=6`：507 个用例，19 个失败。
- 已归因的失败：
  - `selfhost`：本仓库尚未迁移，迁移后通过。
  - `query-drift`：fixture 仍是 v1 宪法，已改为 v2。
  - 其余为 packed CLI 的 `spawnSync ETIMEDOUT`、view-server 的 `ECONNRESET`，以及浏览器定位超时。
- 对这些文件按并发 1 重跑，只剩 `real browser creates a Feature...` 失败。该用例在本分支单独连跑两次均通过，在 HEAD 基线上也通过，判定为偶发。
- 未运行完整的 `pnpm check`（打包、隔离消费者全量测试）。
