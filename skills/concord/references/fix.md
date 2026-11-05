# 修复缺陷

缺陷是实现违反了 Spec。Spec 本身不对时，先按 `concord --skill spec` 改 Spec，不走这个流程。

1. 确认依据：找到被违反的 Use Case 步骤或 cli、library 页条目。还没有 Issue 时创建 `docs/issues/<id>.md`，写现象与复现命令。
2. 提交失败的回归测试：测试标记指向被违反的步骤，并带 `@issue docs/issues/<id>.md`。确认它在当前代码上失败后单独提交。
3. 提交修复，运行项目测试与 `concord check`。
4. 运行 `concord issue close <id> --fixed`：它在两个提交上各运行一次回归测试，通过后删除 Issue，并输出可写进提交说明的结论。

结论只证明这条测试在缺陷提交上失败、在修复后通过，不证明其它情形已覆盖。Issue、核验与 Memory 的细节见 `concord --skill feedback`。
