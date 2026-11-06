# 测试集与测试架构的差距

## 现象

[测试架构](../engineering/testing/README.md)按可观察的边界分层：进程层只保留[跨进程保证](../engineering/testing/README.md#跨进程保证)，CLI 层使用[进程内 CLI](../engineering/testing/architecture.md#进程内-cli)，只读的服务用例使用[共享服务](../engineering/testing/architecture.md#共享服务)。当前测试集与之有差距。2026-11-06 最后一次完整门禁 run-j4BlDg 墙钟 590 秒，上限 300 秒；各层文件耗时之和：纯函数 63 秒、仓库内 302 秒、CLI 846 秒、进程 3021 秒（123 个文件、274 个用例）、浏览器 561 秒（`/tmp/concord-closure/lead5-final-gate-evidence.json`）。

## 差距

- CLI 层每个用例启动一个源码 CLI 子进程（空闲时约 600 ms），没有进程内入口。
- 进程层用真实进程枚举输入组合与错误矩阵，每个用例各自冷启动工作区服务（空闲时约 3.5 s）；各文件的跨进程保证与可下沉候选见 `/tmp/concord-closure/lead5-process-cost-top30.md`。
- 门禁报告没有按新口径分列计时与 Concord 子进程计数。

## 期望

完整门禁与 CI 分片的墙钟满足[成本与稳定](../engineering/testing/README.md#成本与稳定)的上限。迁移按下沉时保持旧保证的规则进行，完成后以 `--reason` 关闭本 Issue，写明迁移提交与最终门禁结果。
