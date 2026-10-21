# Limits

## L1: Bounded authority

静态读取不得运行项目代码或 content mapper，不得引入未捕获的项目文件。编译器资源必须有明确所有者、关闭时机和错误清理。依据为 C-003、C-005、C-007、C-014。

## L2: Public delivery

严格 TypeScript 检查、Effect 副作用组织、既有机器输出与隔离打包消费者契约保持有效。不得绕过类型检查或用双编译器兼容层掩盖迁移缺口。
