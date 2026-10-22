# 约束

## L1: 单一证据权威

Concord 拥有 case identity、source projection、receipt Schema、可靠性规则和正式发布。
消费者不复制这些算法。完整性摘要检测损坏，不防御能修改本地文件的恶意作者。

## L2: 历史证据保留

持久格式、已签发证据和 invocation 历史不重写。配置或实现变化导致证据过期时，必须重新取证。
不降低 Problem 的证据要求，也不建立第二套 fixed 入口。

## L3: 进程拥有清理

协议调用使用受管进程组、硬输出预算与超时。未知清理状态不得发布有效证明。
临时目录、原生进程和容器由消费者拥有并出具资源终结记录。

## L4: 原生协议边界

`concord.test-adapter/v1` 的四个操作只计划和解析原生调用，不包含候选安装和可靠性聚合。
`concord.native-evidence/v2` 不替代 repository formal receipt。进程接入不得伪装两种证据等价。
