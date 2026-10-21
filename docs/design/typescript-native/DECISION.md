# TypeScript 原生编译器

## Decision

Selected: [native-scopes](plans/native-scopes/README.md)

## Rationale

固定完整输入与词法资源作用域满足原生编译器升级的权限边界。单一编译器版本避免语法与类型检查产生两套语义。项目配置与 MDX content mapper 不获得执行权限。

G2: 保留行为与预算为验收约束；实际性能与平台兼容性须通过 C1–C6 验证，设计结论不替代运行证据。

## Rejected Options

legacy-api 保留双编译器，不满足 L2。

## Residual Risks

同步 API 不支持中途取消；输入预算与编辑器任务进程组清理必须有效。beta 的平台产物与 API 可能变化，依赖须精确固定，升级须重验生命周期和输入闭包。source map 转换须解码重编码，不保留错误 delta。
