# 在 Herdr 里使用 Concord的性能预算

本页声明 herdr-mod 高频操作的性能预算，测量方法见[性能测量](../../engineering/performance/README.md#测量方法)，表格写法见[预算表](../../engineering/performance/format.md#预算表)。

## 性能预算

| 场景 | 测量内容 | p50 预算 |
| --- | --- | ---: |
| `herdr-mod/first-screen` | 已初始化的仓库，从加载 mod 到 Feature 的可读描述就绪 | 300ms |
| `herdr-mod/switch-back` | 两个已初始化的仓库来回切换，从切回目标 tab 到离开时的页面重新显示 | 50ms |
| `herdr-mod/switch-new` | 服务已在运行、有 40 个 Feature 的仓库，从切到它到 Feature 的可读描述就绪 | 300ms |

## 刷新上限

两项都用实际构建的 mod 与真实的公开 CLI 测量，只把 Herdr 的界面层换成测试替身，因此不包含真实主机上的绘制时间。

| 场景 | 测量内容 | 上限 |
| --- | --- | ---: |
| `herdr-mod/push` | 文件写入停止到刷新后的可读描述就绪 | 1000ms |
