# 独立交付 Concord mod

## 用户目标

维护者把 Concord mod 直接交付给 Herdr 用户，不创建 CLI Release 或版本标签。

## 起始状态

仓库依赖已安装，mod 源码与真实 Herdr 截图已准备好。使用者通过 Concord 的 `releases/latest` 入口安装 CLI。

## 完整路径

1. 从源码生成可安装目录。 {#build}

   ```sh
   bun run build:herdr
   ```

   命令生成 `concord/RECIPE.md`、`concord/preview.png` 与 `concord/mods/concord/` 下的 `main.js`、`mod.json`、`NOTICE.txt`，不构建 CLI、Web、原生绑定或完整归档，不访问 Release 服务。mod 不记录 CLI 版本。安装说明引导使用者通过 Concord 的 `releases/latest` 入口安装 CLI。

2. 验证可安装目录。 {#verify}

   ```sh
   bun run typecheck
   bun run typecheck:test
   bun run typecheck:scripts
   bun run typecheck:web
   bun run lint
   bun run concord --json --dry-run check
   bun run test --changed
   herdr-app check concord/mods/concord
   ```

   在真实 Herdr 中打开 mod，核对安装提示与文档界面，用 `herdr-app shot` 截图并实际查看。

3. 提交并推送源码和目录。 {#share}

   审阅并提交本次源码、Spec 与生成的 `concord/`，推到 master。用户从仓库目录按[Herdr 安装路径](../../../feature/herdr-mod/use-case/install-from-herdr.md)复制 mod；不要求 CLI 发版。herdr.dev 的发现依赖仓库的 `herdr-mod` topic，推送成功不代表目录站点已经刷新。

## 结果

`concord/` 是可直接安装的分发目录，也是唯一提交到仓库的构建产物。只从源码生成，不手改 JavaScript；CLI 发版不覆盖它。它不参与源码类型检查、文档检查或测试发现。再次生成得到相同内容，不产生本机路径或时间戳。

构建或输入校验失败时命令非零退出，不替换现有分发目录。构建句柄与临时目录在结束时释放。
