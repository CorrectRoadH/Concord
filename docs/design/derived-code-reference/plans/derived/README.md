# 实现声明自动派生查询引用

保留无参数的范围标记和显式 `@concord-implements`；Concord 在扫描时从源路径与结构位置派生查询引用。维护者不需要另行命名。

引用服务于当前查询；它不承诺重构前后身份连续，不进入证据。生成片段时尚未确定源码位置，因此不返回虚构的声明身份。

## Entry Points

- [Architecture](architecture.md)
