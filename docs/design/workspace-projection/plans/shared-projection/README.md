# 共享结构投影

## Problem

Web 全量同步扫描会把来源漂移变成导航失败；CLI 仍需当前事实查询和显式查看同一展示代次。

## Core Mental Model

服务端拥有唯一刷新循环，由来源监听、写入通知和定时补偿触发。HTTP 工作区只读 HawDB 中已发布的结构投影；CLI 的显式缓存入口读同一条记录。投影以 worktree、配置字节和安装产物为键，保存索引、关系、诊断、摘要、构建区间及刷新错误，不保存文件正文。浏览器打开正文时通过 /api/file 取当前内容与前像，编辑器不以历史代次替换定向读取。既有 workspace show 保持严格当前来源语义。

首次没有代次时前台返回构建中；一次有界后台扫描可以发布标注文件或目录漂移的不完整导航。配置变化或待恢复 journal 不得发布。旧一致代次在有漂移的尝试后仍为主展示，并附最近尝试状态。完整扫描和不完整扫描都不能授权写入、check、恢复或证据裁决。刷新由服务进程负责，关闭时确认子进程组清理；CLI 只读缓存，不启动另一个刷新 worker。

## Scope

文件事件合并、监听范围、补偿刷新和展示边界见[来源监听与后台收敛](WATCH.md)。

只改变工作区展示；定向文件读取、动作、check 与当前 CLI 仍读来源。复用 HawDB 的存取、严格解码和身份原语，使用独立 workspace_projection 命名空间的一条固定记录；不复用 trace/review 的 Query、detached worker 或 --fresh 语义。HawDB 或缓存无法安全读取时工作台具名不可用，不回退同步扫描。持久字段、API、刷新 owner 和编辑前像见[投影协议](PROTOCOL.md)。

## Limits

| Limit | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [L1](../../LIMITS.md#l1-owner-bytes-stay-out-of-cache) | satisfied | 持久记录仅保存结构和摘要；正文定向读取 | 设计约束，待打包消费者验证 |
| [L2](../../LIMITS.md#l2-current-authority) | satisfied | 历史代次无写入权限；草稿前像来自定向读取 | C4 负例待验证 |
| [L3](../../LIMITS.md#l3-compatible-cli) | satisfied | 原命令不改；缓存显式入口 | C3 待验证 |
| [L4](../../LIMITS.md#l4-bounded-ownership) | satisfied | 服务单刷新、HawDB 限额、超时清理 | 设计约束，容量与生命周期待实测 |
| [L5](../../LIMITS.md#l5-honest-completeness) | satisfied | 不完整代次携变化路径，未知关系不报健康 | 设计约束，C2 待验证 |
| [L6](../../LIMITS.md#l6-cache-only-workbench) | satisfied | Web 只读缓存；不可用具名失败 | C5 待验证 |

## Goals

| Goal | Status | Mechanism or gap | Evidence |
| --- | --- | --- | --- |
| [G1](../../GOALS.md#g1-editing-does-not-hide-workspace) | satisfied | 旧代次即时可读；首次构建有界返回 | 设计推演，C1、C2 待验证 |
| [G2](../../GOALS.md#g2-cli-keeps-current-query) | satisfied | 当前与显式历史入口 | C3 待验证 |
| [G3](../../GOALS.md#g3-writes-remain-safe) | satisfied | 定向前像，旧代次不驱动草稿 | 设计推演，C4 待验证 |
| [G4](../../GOALS.md#g4-bounded-refresh) | satisfied | 单 owner、期限和容量 | 设计推演，C5 待验证 |

## Entry Points

- [投影协议](PROTOCOL.md)
