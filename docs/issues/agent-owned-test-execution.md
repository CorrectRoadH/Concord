---
relations:
  - role: spec
    target: docs/feature/local-sdlc/use-case/validate-change-with-project-tools.md
  - role: spec
    target: docs/feature/local-sdlc/use-case/collect-native-tests.md
  - role: spec
    target: docs/feature/local-sdlc/cli.md#具体用例绑定输出
  - role: spec
    target: docs/feature/neutral-project-governance/cli.md#docs-work-配置
---

# 测试执行职责仍留在 Concord 实现中

## 现象

CLI、action/RPC 与 Web 仍提供测试执行和修复核验，配置与内置指引仍要求 runner。`issue close --fixed` 会再次执行红绿验证；源码和测试标记仍引用这些已不属于目标 Spec 的能力。

`test list/show` 只返回源码标记与整份观察，没有按新契约提供具体用例绑定。Docs Work 仍可通过任意检查或 finalizer argv 运行项目命令。外部观察清理未知还可能阻断文件发布。

## 待完成

1. 删除 `test run/verify`、Issue fixed/defect/fix 参数和 action 字段、Web 测试任务 API 与结果界面；关闭只原子删除 Issue 和对应标记，保持入链、前像与 journal 保护。
2. 删除 runner 配置、初始化执行器配置、红绿快照、临时验证 worktree、借用依赖、执行选择与报告裁决；同步 `src/app/workflow-skills.ts`、初始化生成指引和配置 Schema。
3. 保留原生收集、label、范围、参数组与 `@native`。收集协议只含 collect-plan/collect-parse；保留安全产物读取、预算、超时、取消和清理。不能以执行测试体补齐清单。
4. `test list/show` 及 Web 统一提供 `bindings`，由现有绑定算法派生具体身份、label、位置与缺口；缺失或过期观察不冒充当前精确绑定。内置收集器按真实能力报告 label、范围和参数组缺口。
5. 外部观察槽位只拥有收集和语言分析；清理未知阻断新的观察，不阻断文档写入或 Issue 关闭。保留观察输入核对，不接管 agent 的测试进程。
6. Docs Work 只调用 Concord 内建静态检查，删除 checks/finalizer 外部 argv 与超时配置。收据不认证 agent 的交付或测试通过。
7. 删除只验证已移除能力的实现与测试，按新行为维护回归及 Spec 标记。收集、具体绑定、静态关联和进程生命周期测试须保留，不能只改标记来伪装已实现。

## 验收

- 项目没有 runner、收集 adapter、测试结果或历史提交时仍可关闭已处理的 Issue；关闭不启动外部测试进程。
- CLI、RPC/action、Web 与初始化都没有测试执行入口或替代的任意命令桥。
- 原生收集和 label 绑定可查，输入过期、范围缺失与绑定歧义如实展示；失败或中断后正确终结自有进程和临时产物。
- 清理未知时新的观察受阻，文档读写与普通 Issue 关闭正常。
- 按工程规则运行受影响的定向测试与静态检查；完整回归由 CI 执行。Spec-only 改动本身不算运行时完成。
