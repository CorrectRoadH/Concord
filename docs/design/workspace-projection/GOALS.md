# 工作区只读投影

## G1: editing-does-not-hide-workspace

工作区导航在文件持续变化时仍能显示已有或新建的可读结果；状态明确标明构建时间、完成性和刷新失败。首次无投影不能无限等待完整一致的全量扫描。[场景 C1、C2](CASES.md) 判定。

## G2: cli-keeps-current-query

`workspace show` 保持当前来源查询；CLI 能显式读取与 Web 同一身份、同一代次的展示投影。[场景 C3](CASES.md) 判定。

## G3: writes-remain-safe

编辑器以定向当前读取建立草稿前像，旧代展示投影不能覆盖较新的草稿或授权任何写入。[场景 C4](CASES.md) 判定。

## G4: bounded-refresh

工作区请求不等待全量扫描；刷新、缓存空间和进程清理有明确预算，并能在服务重启后复用有效代次。[场景 C5](CASES.md) 判定。
