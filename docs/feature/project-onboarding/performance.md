# 渐进式项目初始化与品味治理的性能预算

本页声明 project-onboarding 高频操作的性能预算，测量方法见[性能测量](../../engineering/performance/README.md#测量方法)，表格写法见[预算表](../../engineering/performance/format.md#预算表)。

## 性能预算

按[性能测量](../../engineering/performance/README.md#测量方法)的参照环境与七次采样判定，阈值为参照实测 p50 加约 20% 余量取整。

| 场景 | 测量内容 | p50 预算 |
| --- | --- | ---: |
| `project-onboarding/config` | 读取配置 | 670ms |
| `project-onboarding/doctor` | 接入诊断 | 5250ms |
