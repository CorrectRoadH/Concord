# 修复缺陷

缺陷是实现违反了 Spec。Spec 本身不对时，先按 `concord --skill spec` 改 Spec，不走这个流程。

1. 确认依据：找到被违反的 Use Case 步骤或 cli、library 页条目。
2. 小修复写回归测试和修复，一起暂存。测试标记指向被违反的 Spec，不要求 `@issue`。
3. 运行 `concord test verify --staged` 与相关测试、`concord check`，核验通过后一次提交，把输出结论写进提交说明。提交后用 `concord test verify --fix <commit>` 重放。
4. Issue 只在工作要留到以后或交给别人时才建。已有 Issue 时给测试加 `@issue docs/issues/<id>.md`；测试与修复可以同一提交，也可以先单独提交失败回归再提交修复。之后运行 `concord issue close <id> --fixed`，核验通过后删除 Issue 与对应标记。

结论只证明选中的冻结命令在红快照上失败、在绿快照上通过，不证明其它情形已覆盖。Issue、核验与 Memory 的细节见 `concord --skill feedback`。
