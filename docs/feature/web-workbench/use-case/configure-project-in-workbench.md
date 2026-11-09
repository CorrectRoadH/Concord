# 在工作台维护项目设置与反馈连接

## 用户目标

维护者想在浏览器里查看和修改项目的 `concord.config.ts`、配置 GitHub 或 Linear 反馈连接，并在配置出错或工作区需要恢复时看到具体诊断与恢复入口。

## 起始状态

- `concord view` 正在运行，浏览器已打开工作台地址。

## 完整路径

1. 打开「项目设置」查看生效的配置与原文。 {#open-settings}

   点击左侧主侧栏的「项目设置」，页面展示当前生效的测试根、源码根、runner 配置，以及服务端安全读取的 `concord.config.ts` 原文与摘要：

   ```text
   项目设置
   concord.config.ts
   testRoots: test, tests
   sourceRoots: src
   runner: node-test
   ```

2. 修改配置并自动保存。 {#save-config}

   在项目设置中修改 `testRoots`、`sourceRoots` 或 `runner` 后停止输入 800ms，工作台以读取时的配置原文作为前像提交 `config.set`，写入 `concord.config.ts`。保存后工作台显示构建中，按新配置重新构建工作区投影（[自动保存](../ui.md#自动保存)）。

3. 维护外部反馈连接。 {#configure-feedback}

   在项目设置的来源配置区添加或更新 GitHub 仓库或 Linear 团队连接。列表以目标仓库或团队为主信息，运行环境与连接状态为次级信息；凭据环境变量未设置、未安装 `gh` 或无访问权限时，条目旁直接给出对应的操作提示（[反馈与设置](../ui.md#反馈与设置)）。

4. 在「诊断与工具」中查看健康状态或执行恢复。 {#inspect-workspace-health}

   点击主侧栏的「诊断与工具」，查看工作区扫描完整性、配置诊断与缓存状态。若上一次写入中断留下了 `RecoveryRequired` 阻断，点击页面上的恢复入口回收已退出持有者的锁并完成恢复，随后自动触发工作区刷新。

## 结果

配置与反馈连接写回 `concord.config.ts`，工作区投影切换为新配置的结果，CLI 与工作台立即共用新设置。

| 情形 | 看到什么 |
| --- | --- |
| 仓库还没有 `concord.config.ts` | 显示约定默认值；修改并保存后创建 `concord.config.ts` |
| 输入非法 JSON、未知字段或运行时表达式 | 拒绝写入并显示 `InvalidData` 或 `InvalidConfigSyntax`；切换表单与 JSON 视图不丢失未保存输入 |
| 保存时 `concord.config.ts` 已被外部编辑 | 拒绝覆盖，保留当前草稿供对比处理 |
| `concord.config.ts` 语法损坏时打开工作台 | 设置页仍显示服务端安全读取的原文与具名诊断，不把配置错误显示成待初始化 |
| 确认丢弃设置页中的非法草稿 | 恢复为磁盘上的配置内容，不会有迟到的自动保存覆写文件 |

## Spec 来源

- [工作台界面](../ui.md#反馈与设置)
- [安全维护项目配置](../../project-onboarding/use-case/maintain-project-config.md)
- [CLI 与 Web 操作对应](../cli.md)
