# TypeScript 原生编译器与受限输入生命周期

TypeScript 7.1 的编译器 API 通过包内原生子进程提供解析、诊断与模块解析。Concord 必须明确其输入与释放边界，同时保留配置静态读取、源码标记和 p5 的既有语义。

## Entry Points

- [Goals](GOALS.md)
- [Limits](LIMITS.md)
- [Cases](CASES.md)
- [Decision](DECISION.md)
- [受限作用域](plans/native-scopes/README.md)
- [保留旧编译器 API](plans/legacy-api/README.md)

## Constitution

- [C-002](../../constitution.md#c-002)
- [C-003](../../constitution.md#c-003)
- [C-005](../../constitution.md#c-005)
- [C-007](../../constitution.md#c-007)
- [C-014](../../constitution.md#c-014)
