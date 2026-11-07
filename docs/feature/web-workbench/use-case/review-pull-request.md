# 在 PR 预览中审阅变更

## 用户目标

审阅者从 PR 打开 Concord 预览，看到这个 PR 相对它的合并目标分支引入的变更，包括文档改动前后的正文。目标分支由 PR 的 base 决定，不假定名为 main。

## 起始状态

- 消费者项目的 CI 已有静态 Preview 托管，能在 PR 中放一个链接。
- CI 能取得 PR 的目标分支、base commit 与 head commit。

## 完整路径

### 消费者接入

1. 消费者 CI 准备 PR 身份、Git 历史与 Concord。 {#prepare}

   消费者拥有 PR 身份、Git 历史与托管，须满足：

   - PR head 等于构建提交与检出的 HEAD，拒绝检出 merge 提交。构建前与部署前各查询一次 PR，base ref、base SHA 或 head SHA 变化即失败。
   - 补全 shallow 历史与缺失的对象后再导出，历史中要包含 base 与 head 的共同祖先。
   - 用[安装脚本](../../cross-platform-release/use-case/install-with-script.md)加 `CONCORD_VERSION` 安装固定版本的 Concord 发版归档，按 Release 的 `SHA256SUMS` 校验。导出与部署前的校验都用这一份 CLI，不依赖相邻源码或未发版的版本，不手改归档。

### 导出与审阅

2. 导出静态预览。 {#export}

   ```sh
   concord view export --base 5ae5556b04a9e27e2c6e56f47ac44aee01663bd5 --head f67b833a744dc75fe3c48057f75a887ff3f86fb8 --base-label master --out ./concord-preview
   ```

   ```text
   view export
   output: /home/ci/shop/concord-preview
   comparison:
     base: 5ae5556b04a9e27e2c6e56f47ac44aee01663bd5
     head: f67b833a744dc75fe3c48057f75a887ff3f86fb8
     mergeBase: 5ae5556b04a9e27e2c6e56f47ac44aee01663bd5
     baseLabel: master
   files: 5
   ```

   比较范围是 `merge-base(base, head)` 到 head。`--out` 必须是还不存在的新目录；参数、`--json` 输出与错误见 [PR 静态预览导出](../cli.md#pr-静态预览导出)。

3. 部署前核对产物。 {#check}

   ```sh
   concord view verify ./concord-preview --json
   ```

   ```json
   {
     "operation": "view-verify",
     "directory": "/home/ci/shop/concord-preview",
     "comparison": {
       "base": "5ae5556b04a9e27e2c6e56f47ac44aee01663bd5",
       "head": "f67b833a744dc75fe3c48057f75a887ff3f86fb8",
       "mergeBase": "5ae5556b04a9e27e2c6e56f47ac44aee01663bd5",
       "baseLabel": "master"
     },
     "files": 5
   }
   ```

   命令严格解码 `changes.json` 并检查输出目录的构成，失败时以具名错误和字段路径退出 1，见[校验产物](../cli.md#校验产物)。通过后核对输出中的 base、head 与 baseLabel，再独立计算 merge-base 与 `comparison.mergeBase` 比对。产物的结构见 [PR 预览产物](../format.md#pr-预览产物)。

4. 接入静态 Preview，从 PR 链接过去。 {#publish}

   把输出目录交给已有的静态 Preview 托管，可以部署在子路径下。部署哪些内容由消费者审阅：输出包含所比较的已提交内容。

5. 审阅者打开预览。 {#review}

   页面顶部给出目标分支与比较身份，左侧是变更文件树，右侧是选中文件的差异：

   ```text
   Concord
   PR 变更 · 只读
   master
   5 个文件
   base 5ae5556b04a9e27e2c6e56f47ac44aee01663bd5
   head f67b833a744dc75fe3c48057f75a887ff3f86fb8
   merge-base 5ae5556b04a9e27e2c6e56f47ac44aee01663bd5

   concord.config.ts   A
   docs
     feature
       cart
         README.md       M
   …

   concord.config.ts
   差异  统一  分栏
   前：不存在
   后：100644 · 1e8d168c0b46f93dd10ceaa858c8ef28bd776b8e
   ```

   选择文件阅读差异；Markdown 文件还可以分别查看变更前与变更后的正文。选中的文件写在链接里，分享链接即可回到同一个文件。所有内容来自已冻结的提交。

## 结果

预览只有静态阅读能力：没有编辑、测试执行、工作区服务 API 或凭据。页面不把 diff 或测试声明当作执行证据。Concord 不获取远端凭据、不 fetch、不部署，也不写 PR 评论。

| 情形 | 看到什么 |
| --- | --- |
| 目标分支在 PR 创建后又有新提交 | 这些提交不出现在 PR 差异中 |
| 目标分支不是 main、detached HEAD、fork 的已取得 head | 照常导出 |
| 删除、重命名、没有变化 | 照常导出 |
| worktree 中有未提交的改动 | 不进入输出 |
| 缺失 revision、浅历史、多个最佳共同祖先、超出导出上限、输出路径不安全 | 按 [CLI 错误](../cli.md#错误)具名失败，不回退到 main 或本地 HEAD |
| 输出目录已经存在 | 返回 `PreviewOutputExists`，退出 1 |
| 同一目标并发导出 | 只有一份成功 |
| 导出中途失败 | 保留不完整的输出，不覆盖或删除未知内容 |
| 二进制文件、子模块、符号链接 | 只显示对象，不读取外部目标 |
| Markdown 含恶意 HTML 与链接 | 不执行脚本，不加载图片或远程资源，不产生 mutation 请求 |

导出由固定版本的发版归档独立完成，不需要相邻源码、全局安装或 Rust 编译器。验收用隔离的 Git 消费者，经已安装的 CLI 与 `concord view verify` 覆盖以上各项，另含脏 attributes、replace refs、子模块忽略配置、非 UTF-8 路径、大对象小 patch，以及未初始化、配置无效与在子目录启动；取消时回收 Git 子进程与临时目录。部署与远端链接只由已授权的真实部署证明。
