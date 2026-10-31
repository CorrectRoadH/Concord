---
status: closed
closure:
  kind: invalid
  evidence:
    - b92a806 源码复现 cart-store 两候选：8 条 DesignResponseIncomplete 全部唯一；每个 L1/G1 各指明 Mechanism or gap 与 Evidence。实现 src/model/design-content.ts:133，构建 CLI 回归 test/cli/cli-2.test.ts:36；列名诊断已在历史提交 5fbaea3 采用。
---

# design check 对同一条要求重复报告相同 finding

## 观察

新建 Design 后立即运行 `concord --json design check <id>`，同一个候选的同一条要求出现两条完全相同的 finding：

```text
docs/design/cart-store/plans/memory/README.md
  DesignResponseIncomplete: L1 requires authored mechanism/gap and evidence
docs/design/cart-store/plans/memory/README.md
  DesignResponseIncomplete: L1 requires authored mechanism/gap and evidence
```

G1 与另一个候选的 L1 也各重复一次。

## 复现

`concord design create cart-store --title "购物车存储" --alternative memory --alternative sqlite`，然后 `concord design check cart-store`。

## 待判断

两条是否分别对应“机制或缺口”与“依据”两列。如果是，message 应当指明哪一列；如果不是，应当去重。
