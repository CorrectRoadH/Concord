---
status: closed
closure:
  kind: closed
  reason: 7e88232 修复成员枚举与末次核验的新鲜读取；回归测试在 4dd7b97 上 4 条失败（/tmp/p3-stale-read-red-4dd7b97.log）、7e88232 上 4 条通过（/tmp/p3-stale-read-green-7e88232.log）；修复提交同时改了其中一条回归测试的断言，冻结区间不成立，故不记 fixed。
---

# 只读观察复用让枚举与末次核验读到旧状态

## 现象

提交 a3e9de8 为减少重复读取，在一次操作内复用只读观察。复用范围超出了可以复用的部分：

- `files()` 复用了先前的成员列表，没有重新枚举目录，新增或删除的文件不被看到。
- `repo.read()` 复用了先前读到的字节，返回前的末次核验因此比对的是旧内容，读取期间的外部写入不被发现。

完整门禁的源码层因此有 4 个测试失败（/tmp/p3-full-gate-plain-frame.log）。

## 期望

成员集合每次重新枚举，返回前的核验重新读取原文字节（[读取与发布](../feature/web-workbench/architecture.md#读取与发布)、[L1](../design/cli-hot-path/LIMITS.md#l1-缓存成功结果与同源重建一致)）。只复用不改变结论的不可变证明。

## 修复

先提交带 `@issue` 标记、在 a3e9de8 之后失败的回归测试，再提交恢复新鲜读取的修复。
