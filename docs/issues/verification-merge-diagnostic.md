# 核验区间的 merge 诊断缺少位置

含 merge 的区间只报告固定消息，没有提交身份和区间参数提示。

复现：`bun run test test/domain/verification-merge-diagnostic.test.ts`。
