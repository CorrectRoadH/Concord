# Decision record

## Decision

Selected: [scoped](plans/scoped/README.md)

## Rationale

操作依赖由目标与不变量决定。乐观来源核验保护合作发布的一致性，局部 owner 查询消除无关内容错误的传播，全局诊断显式保留不完整状态。准确 token 恢复、完整性传播与 runner 阻塞规则由所选方案明确约束。

## Rejected Options

global 保留全仓库加载和默认独占访问，无法满足局部故障隔离与读取并发。未经观察与代次核验的直接读取可能返回多文件发布的混合状态，不满足一致性要求。

## Residual Risks

当前来源快照在并发发布时可能失败重试；未完成 journal、配置损坏和未知进程资源仍受各自门禁约束。文件锁不观察不合作编辑器的全部瞬时变化。PID 复用保守阻断；macOS issue #1 现场仍需真实平台证据，不能由 Linux 成功替代。
