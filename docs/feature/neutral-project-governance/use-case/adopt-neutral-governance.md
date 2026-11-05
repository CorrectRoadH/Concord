# 按 Concord 规范接入软件项目

## 用户目标

维护者将有真实实现和测试的软件项目接入 Concord，以同一套 Spec、关联、Issue、Memory 与审阅规则管理开发，而不复制其它产品的仓库工具。

## 完整路径

1. 项目使用固定布局与默认发现范围，测试或实现不在默认位置时在配置中覆盖 `testRoots` 与 `sourceRoots`；需要运行测试时配置 `runner`。品味文件存在即生效。
2. Feature / Use Case 定义目标与可观察验收；实现和真实测试用源码标记引用 canonical Spec。
3. 查询、追踪与 Web 展示从权威源码派生关系，不因项目没有某个产品的通道、包名或 host 而失败，也不隐式运行测试。
4. 通过项目的 runner 运行测试，结果只按 runner 退出码解释，不声称逐 case 覆盖或正式可靠性。
5. 缺陷记为 Issue；先提交会失败的回归测试，再提交修复，以 fixed 关闭前通过[修复核验](../../local-sdlc/README.md#证据的范围)。缺测试、缺提交、区间含 merge 或 shallow clone 时具名返回 `FixUnverifiable`。
6. 用打包后 Concord 与真实消费仓库验证接入，保留未完成事务及未知编辑。

## 验收

通过打包后公开 CLI 在隔离 Git 项目中执行；静态检查与真实闭环互不替代：

- 没有 NiceEval/Nx 产品配置、通道或执行器分类的软件项目完成 Spec→实现/测试关联→执行→Issue 修复核验→审阅闭环；源码声明不被显示为执行通过。
- 没有 `concord.config.ts` 的项目可以使用静态查询、trace 与 Web；缺少 `runner` 只阻断测试运行与修复核验。
- 测试位于默认根之外时，经 `testRoots` 覆盖后可以静态查询。
- 任一入口写入的 fixed 关闭都带核验结论；删除 runner 配置不能使没有核验的 fixed 通过检查。
- 活跃锁、pending journal 与未知前像不能被新入口绕过。
- 原有 Web 未提交编辑保留；验收不 push、不发布、不做远端写入或付费调用。

## Spec 来源

- [统一项目治理](../README.md)
- [治理边界](../architecture.md)
- [品味](../../../taste.md)
