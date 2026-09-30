# 共同验收场景

| Case ID | User Problem | Fixed Input | Acceptance Result |
|---|---|---|---|
| C1 | PR 合并到 release 分支 | base 与 head 分叉，base 另有提交 | 仅显示共同祖先到 head 的变更，标明 release |
| C2 | CI checkout 与本地文件不同 | 明确 head，另有脏工作树或 detached checkout | 只读取给定提交；身份不符具名失败 |
| C3 | 阅读文件演进 | 新增、删除、重命名、二进制、symlink、特殊文件名 | 名称和状态准确；不读取外部目标 |
| C4 | 分享文档变更 | 子路径部署、恶意 HTML 与链接 | 深链接可刷新；原始脚本不执行，无 mutation |
| C5 | CI 交付与失败清理 | 固定安装包、缺失历史、超限或已有输出目录 | 独立包完成导出，失败不覆盖未知内容 |
