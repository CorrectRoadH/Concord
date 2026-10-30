# 可靠原生证据的进程接入

消费者通过版本化进程协议调用 Concord，不在 runner 中加载 Concord 的内部模块或 Effect 服务。
Concord 继续拥有声明身份、来源投影、证据格式与最终裁决；消费者继续拥有构建、安装、原生执行及资源终结。

本主题比较保留模块 host 与进程桥接。普通 test-adapter 的原生观察不升级为可靠性证明。

- [目标](GOALS.md)
- [约束](LIMITS.md)
- [验收场景](CASES.md)
- [进程桥接](plans/process-bridge/README.md)
- [模块 host](plans/module-host/README.md)
- [裁决](DECISION.md)

## Constitution

- [C-004](../../constitution.md#c-004)
- [C-007](../../constitution.md#c-007)
- [C-010](../../constitution.md#c-010)
- [C-013](../../constitution.md#c-013)
- [C-015](../../constitution.md#c-015)
