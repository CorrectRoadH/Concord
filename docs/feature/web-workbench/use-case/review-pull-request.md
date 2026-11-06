# 在 PR 预览中审阅变更

审阅者打开 PR 提供的 Concord 预览，看到该 PR 相对于合并目标分支引入的变更。目标分支由 PR 的 base 决定，不假定名称为 main。

## 主流程

1. 消费者 CI 取得 PR 的目标分支、base commit 与 head commit，并准备包含共同祖先的 Git 历史。
2. 运行 `concord view export --base <base-commit> --head <head-commit> --base-label <target-branch> --out <new-directory>`。
3. 消费者将输出目录接入既有静态 Preview，并从 PR 链接到该页面。
4. 审阅者看到目标分支、base、head 与 merge-base 身份，选择文件并阅读差异。文档同时提供变更前后正文；所有内容来自已冻结提交。

## 消费者接入

消费者拥有 PR 身份、Git 历史与托管，须满足：

- PR head 等于构建提交与 checkout HEAD，merge checkout 拒绝；构建前与发布前各查询一次 PR，base ref、base SHA 或 head SHA 变化即失败。
- 补全 shallow 历史与缺失对象后再导出。
- 发布前用[库包解码器](../library.md)核对 `changes.json` 的 base、head、baseLabel，并独立计算 merge-base 比对。
- 用[安装脚本](../../cross-platform-release/use-case/install-with-script.md)加 `CONCORD_VERSION` 安装固定版本的 Concord 发布归档，按 Release 的 `SHA256SUMS` 校验；解码器取自同版本的[库包](../../local-sdlc/library.md#安装)。不依赖相邻源码或未发布版本，不手改归档。

## 验收

- 比较为 `merge-base(base, head)` 到 head；目标分支独有的后续提交不出现在 PR 差异中。
- 支持非 main 目标、detached HEAD、fork 的已取得 head、删除、重命名和无变化；工作树未提交内容不进入输出。
- 缺失 revision、浅历史、多个最佳共同祖先、预算超限和不安全输出路径按 [CLI 错误](../cli.md#pr-静态预览导出)具名失败，不回退 main 或本地 HEAD。已有输出目录被拒绝，同一目标并发只有一份成功；失败保留不完整输出，不覆盖或删除未知内容。
- 页面可部署在子路径；选择文件可通过链接恢复。二进制、子模块与符号链接不读取外部目标。
- 预览仅有静态阅读能力，无编辑、测试执行、工作区 API 或凭据；含恶意 HTML 与链接的 Markdown 不执行脚本、不加载图片或远程资源，不产生 mutation 请求。
- 导出由固定版本的发布归档独立完成，不需要相邻源码、全局安装或 Rust 编译器。
- 输出包含所比较的已提交内容，发布范围由消费者审阅；Concord 不获取远端凭据、不 fetch、不部署、不写 PR 评论。
- 页面不把 diff 或测试声明当作执行证据。
- 隔离 Git 消费者经已安装 CLI 与公共解码器覆盖以上各项，另含脏 attributes、replace refs、子模块忽略配置、非 UTF-8 路径、大对象小 patch，以及未初始化、无效配置与子目录启动；取消回收 Git 子进程与临时目录。部署与远端链接只由已授权的真实部署证明。
