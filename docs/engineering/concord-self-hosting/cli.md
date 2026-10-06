# 自举检查命令

自举 runner 为：

```text
node --import tsx --test --test-name-pattern {pattern} {file}
```

占位符逐 argv 参数替换，不经过 shell。日常只读检查依次使用 `concord doctor`、`concord check`、`concord test list`、`concord trace check`、定向 `concord trace show local-sdlc` 与 `concord review render local-sdlc`。需要真实收据时才使用 `concord test run <case>`。

最终仓库验收由父流程执行 `pnpm check`；自举 smoke 不在 Node test 内递归调用该命令。

## 性能测量命令

测量路径与 profile 的完整参数和记录格式见[性能验收](performance.md#测量路径)。常用组合：

```sh
# 本仓库 HEAD 的 clone 上测量 CLI 预算，与父提交基线交错对照
pnpm bench cli --baseline ../concord-baseline

# 大仓库规模下的刷新扫描是否在后台刷新上限内，以及缓存读取预算
pnpm bench query --consumer scale

# 复现某个外部仓库的刷新超时：先克隆成干净副本再原地测量
git clone ~/Downloads/rpg-game /tmp/rpg-game-frozen
pnpm bench query --consumer /tmp/rpg-game-frozen --samples 3

# 定位刷新扫描耗时：CPU 热点、system 时间与 fs 调用次数
pnpm bench:profile refresh --consumer scale
pnpm bench:profile cli --consumer self --warm -- check
```

`--samples` 低于 7 的记录只用于定位，不作为预算验收证据。
