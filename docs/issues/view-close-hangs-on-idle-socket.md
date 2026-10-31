---
status: closed
closure:
  kind: closed
  reason: 170eca9 修复；回归测试 43c6dcf 保留在测试集中并通过。缺陷提交的 runner.sourceFiles 含目录，早于文件级冻结，无法按修复核验重放，故不记 fixed。
---

# 关闭 view 服务时未发请求的连接使其挂起

## 现象

已建立但从未发送 HTTP 请求的连接（浏览器的预连接）会让打包安装的 `concord view` 在关闭时一直等待。`entry/http/view-server.ts` 关闭时只调用 `closeIdleConnections`，这类连接不被视为空闲；进程内测试 fixture 在 `server.close()` 之外另调 `closeAllConnections`，掩盖了这一缺口。

## 期望

按 [Web 工作台的关闭顺序](../feature/web-workbench/architecture.md)，关闭先停止接收并中断全部连接，再等待扫描与作业释放，不因残留连接挂起。
