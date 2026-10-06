# 以 realpath 比较

快照内 `absolute(path)` 计算 `target = resolve(root, path)` 后调用 `realpathSync.native(target)`，结果必须与 `target` 逐字节相同，否则抛 `UnsafePath`；目标不存在时对最近存在的祖先做同样比较。写入路径保持原完整检查。
