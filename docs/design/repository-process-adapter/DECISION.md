# 进程接入裁决

## Decision

Selected: [process-bridge](plans/process-bridge/README.md)

## Rationale

Concord 独占治理算法与最终证据门，消费者拥有原生观察和资源；传输替换无需改写历史证据。外层唯一进程组、锁外冻结输入、锁内本地重验使终结与发布责任闭合。

G1: 完整消费者迁移由架构中的逐项映射定义；C1/C4 的安装后闭环必须实施后验收，设计选择不宣称已运行。

G2: 保留唯一 validator、历史 evidence floor、epoch 与 invocation 防复用；C1/C3 的故障与真实可靠性证明仍是交付条件。

G3: transport 与 capability 错误保留具名原因；C2 验证错误、预算和清理路径，不以静态审查代替。

## Rejected Options

[module-host](plans/module-host/README.md) 保留内部 Effect 与精确库安装耦合，不能满足 G1；只保留为既有消费者路径，不作为新接入方案。

## Residual Risks

依赖安装完整性仍信任 frozen lock 与包管理器；adapter 的源码闭包与 guard 声明属于受信任接入契约，不构成恶意代码沙箱。POSIX 进程组不可观察的平台拒绝新 transport。执行结果超出 envelope 预算时拒绝，不能裁剪证据。实现身份改变使旧 managed 结果不再 current，但其历史和证据下限必须保留。
