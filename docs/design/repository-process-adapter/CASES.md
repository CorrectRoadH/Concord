# 验收场景

## C1: 无 Concord 库的消费者

隔离 Git 项目只安装自身 runner 依赖，通过安装后的 Concord CLI 收集真实用例、取得 red 与七次 green/reliability 观察，完成关系发布、fixed、reopen。
重新关闭时拒绝旧 epoch 和已使用 invocation。项目不使用 NiceEval、Nx 或固定测试目录。

## C2: 异常协议与生命周期

分别注入未知字段、重复键、错误 requestId、额外 stdout、超限输出、非零退出、超时、取消和存活子进程。
每项都具名失败；没有有效收据、残留进程或跨调用响应复用。

## C3: 证据完整性

分别改变源码、契约、adapter 实现、候选包、epoch、副本身份与 cleanup。
同副本不连续、隔离副本相同、retry、skip 和零执行必须被拒绝。历史原件字节不变。

## C4: 消费者接入

NiceEval 的计划和打包无需加载 Concord 库。既有产品 E2E expected 保持不变，采用同一候选完成一个无付费的正式可靠性闭环。
文档 reference、PR 关系读取和 Preview 沿各自公开命令验证。完整产品矩阵交给 CI。
