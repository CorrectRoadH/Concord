---
status: closed
closure:
  kind: fixed
  reason: HTTP 受理与操作交接前核对服务锁 device/inode；替换锁后拒绝发布，冻结回归在缺陷提交失败并在修复提交通过。
  verification:
    defect: f782884122dde4ccdff52f4b40652862c35da944
    fix: 77f6309ce30ec6ffc4ce28af6f7fdfd706349d46
    tests:
      - neref_f4784e5a792a81cd0b9c93c6e3c0814c
    runner: sha256:db83e0ff88b65dcaaf52a8f69c6262dbd1b596991eee44d5fcf69e1a65b4e8e0
    concord: dev
---

# HTTP 写入没有核对服务锁

## 现象

工作区服务的服务锁文件被替换（device/inode 改变）后，经 HTTP 发起的写入仍返回 200 并写入成功。回归测试见 `test/process/workspace-operation-authority.test.ts`（提交 0b4845b）。

## 期望

服务在受理请求、绑定、发布与清理前核对服务锁路径的 device/inode 与自身持有的一致；不一致时进入 stopping，不再受理写入（[状态](../feature/local-data-engine/architecture.md#状态)）。
