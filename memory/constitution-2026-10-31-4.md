---
type: decision
status: current
relations:
  - role: amends
    target: docs/constitution.md#c-002
  - role: amends
    target: docs/constitution.md#c-002-1
  - role: amends
    target: docs/constitution.md#c-002-2
  - role: amends
    target: docs/constitution.md#c-002-3
  - role: amends
    target: docs/constitution.md#c-003
  - role: amends
    target: docs/constitution.md#c-003-1
  - role: amends
    target: docs/constitution.md#c-003-2
  - role: amends
    target: docs/constitution.md#c-003-3
  - role: amends
    target: docs/constitution.md#c-005
  - role: amends
    target: docs/constitution.md#c-005-1
  - role: amends
    target: docs/constitution.md#c-005-2
  - role: amends
    target: docs/constitution.md#c-005-3
  - role: amends
    target: docs/constitution.md#c-005-5
  - role: amends
    target: docs/constitution.md#c-006
  - role: amends
    target: docs/constitution.md#c-006-1
  - role: amends
    target: docs/constitution.md#c-006-2
  - role: amends
    target: docs/constitution.md#c-006-3
  - role: amends
    target: docs/constitution.md#c-007
  - role: amends
    target: docs/constitution.md#c-007-1
  - role: amends
    target: docs/constitution.md#c-007-2
  - role: amends
    target: docs/constitution.md#c-007-3
  - role: amends
    target: docs/constitution.md#c-007-4
  - role: amends
    target: docs/constitution.md#c-015
  - role: amends
    target: docs/constitution.md#c-015-1
  - role: amends
    target: docs/constitution.md#c-015-2
  - role: amends
    target: docs/constitution.md#c-015-3
  - role: amends
    target: docs/constitution.md#c-024
---

# 品味文件只保留品味，底线移入所属页面

宪法修订，日期 2026-10-31。

## 适用范围

Concord 自身的品味文件，以及承接底线的页面：local-sdlc 的 `scope.md` 与 `cli.md`、工程页 `concord-self-hosting/README.md` 和 `docs/architecture.md`。

## 理由

维护者指出底线不是品味：独立本地、写入安全、技术栈、协作授权与机器可读输出，是产品要求或工程规则，应写在它们所属的 Spec。C-002 第 1 款还把产品承诺与“在隔离 Git 消费者中验证”这一测试方法混在一起。Spec 的修改历史由 Git 保存，品味文件不再要求另附修改记录。

## 影响

- C-002、C-003、C-005、C-006、C-007、C-015 移出：C-002 与 C-003 进入 local-sdlc 的 `scope.md`，C-015 进入 local-sdlc 的 `cli.md`，C-005、C-006 与 C-007 第 1 至 3 款进入工程页，C-007 第 4 款进入 `docs/architecture.md`；C-002 第 1 款去掉测试方法。
- 总则删去底线相关两款，修改改为直接编辑、历史由 Git 保存。
- Spec 页面的“依据的品味”列表只保留品味。

## 来源

- `docs/constitution.md`
