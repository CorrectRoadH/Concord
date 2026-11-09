# 在 CI 与分支合并时运行检查门禁

## 用户目标

维护者在 CI 和分支合并后运行合并检查，拦住跨分支修改造成的断链、旧写法与页面违规，并在命令退出前自动回收本次启动的工作区服务。

## 起始状态

- 接入项目已在 Git 仓库中完成初始化，并提交了 `docs/`、源码标记与测试标记。
- CI 运行在受支持的 Linux x64 或 Apple Silicon macOS 环境。

## 完整路径

1. 在 CI 中安装固定版本的 Concord。 {#install-in-ci}

   按[用一行命令安装](../../cross-platform-release/use-case/install-with-script.md)传入 `CONCORD_VERSION` 安装归档：

   ```sh
   curl -fsSL https://github.com/CorrectRoadH/Concord/releases/latest/download/install.sh | CONCORD_VERSION=0.9.0 sh
   ```

   归档自带运行时与 ripgrep，CI 机器不需要预装 Node.js、pnpm 或 Rust 编译器。

2. 用命令作用域运行合并检查。 {#run-command-check}

   ```sh
   concord --server=command --json check
   ```

   ```json
   {
     "operation": "check",
     "ok": true,
     "complete": true,
     "findings": [],
     "checks": {
       "relations": {"ok": true, "complete": true},
       "writing": {"ok": true, "complete": true}
     },
     "advisories": []
   }
   ```

   `--server=command` 让工作区服务归本次命令所有，命令返回前回收服务进程与持久缓存句柄，不在 CI 机器上留下后台进程。

3. 修复分支合并后出现的语义漂移。 {#fix-merge-drift}

   一个分支移动了 Spec、重命名了步骤或在 `concepts.md` 中把旧名词列入旧写法，另一个分支在旧基础上新增了测试标记或文档段落时，Git 合并可能没有文本冲突，但合并后的 `check` 会失败：

   ```text
   check
   ok: false
   complete: true
   findings:
     docs/feature/cart/README.md:27
       bannedTerm: 单子: use 订单; docs/concepts.md#order
     test/checkout.test.js:1
       ReferenceNotFound: Reference target does not exist: docs/feature/cart/use-case/add-item.md
   ```

   按 `findings` 给出的文件与行号更新术语和标记目标，再次运行 `concord check` 直到通过。

## 结果

关系检查与写作检查在同一次门禁中完成，跨分支的语义不一致在合并前被拦下。

| 情形 | 结果 |
| --- | --- |
| 全部关系、页面种类与写作规则通过 | `ok` 为 `true`，退出码 0；命令退出后 `concord server status` 为 `absent` |
| 存在任何 `finding` 或 `complete` 为 `false` | `ok` 为 `false`，退出码 1 |
| 项目中的工作流 skill 版本较旧，产生 `WorkflowSkillsOutdated` | 列在 `advisories` 中，`ok` 仍为 `true`，退出码 0，不阻断 CI；维护者在本地运行 `concord skills install` 更新 |
| 本地开发目录已有共享工作区服务在运行，却传入 `--server=command` | 拒绝接管已有服务并具名失败；本地开发直接运行 `concord check` 复用共享服务（[适配项目的开发方式](../../../taste.md#t-9)） |
| CI 还需要为 PR 生成只读预览页面 | 在检查通过后按[在 PR 预览中审阅变更](../../web-workbench/use-case/review-pull-request.md)运行 `concord view export` 与 `concord view verify` |

## Spec 来源

- [命令体验](../cli.md)
- [命令作用域查询](../../local-data-engine/architecture.md#命令作用域查询)
- [合并检查](../../documentation-quality/cli.md#合并检查)
