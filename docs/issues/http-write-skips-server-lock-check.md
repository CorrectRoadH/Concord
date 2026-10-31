---
status: open
---

# HTTP 写入没有核对服务锁

## 现象

工作区服务的服务锁文件被替换（device/inode 改变）后，经 HTTP 发起的写入仍返回 200 并写入成功。回归测试见 `test/process/workspace-operation-authority.test.ts`（提交 0b4845b）。

## 期望

服务在受理请求、绑定、发布与清理前核对服务锁路径的 device/inode 与自身持有的一致；不一致时进入 stopping，不再受理写入（[状态](../feature/local-data-engine/architecture.md#状态)）。
