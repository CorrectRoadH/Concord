# 目标

## G1: 消费者独立运行

消费者 runner 不安装或 import Concord 的内部库；全局 CLI 与消费者无需共用 Effect 实例。
普通计划、打包与执行不因 eager import 加载治理实现。需要治理时从公开机器接口请求能力。

## G2: 保持可靠性下限

原生绑定、候选字节、来源投影、Problem epoch、独立与同副本运行、默认并行、无 retry 和清理仍由相同规则核验。
普通 native 观察不能关闭采用可靠性要求的 Problem。

## G3: 失败可定位

缺能力、协议不匹配、引擎漂移和清理失败保留具名原因。静态 help 与查询不启动执行 adapter。
