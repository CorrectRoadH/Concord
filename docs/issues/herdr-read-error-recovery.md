---
relations:
  - role: spec
    target: docs/feature/herdr-mod/architecture.md#数据
---
# 首次读取失败后不再恢复

## 现象

远程仓库首次读取返回 `CleanupFailed` 后，mod 留在错误状态页。服务恢复时仍不发起读取，必须离开再返回才能恢复，违反错误修好后自动恢复的约定。

## 复现

运行 `bun run gate test/model/herdr-mod-host.test.ts --test-name-pattern='source mod obeys'`。用命令边界返回首次读取失败，随后恢复命令响应，只推进宿主定时任务而不重绘或切换目录。

## 期望

当前仓库的只读刷新失败后继续定时重试；同一时刻最多有一次刷新，切换仓库或关闭后回收重试。成功读取后错误消失，不重放写入。
