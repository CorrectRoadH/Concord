# 删除仍被依据的条目

## 用户目标

维护者想删除一条不再适用的品味，但有页面还在依据它；项目希望删除后不留下断开的引用。

## 起始状态

- `docs/taste.md` 中有 `T-3`。
- Feature `cart` 的 README 和一个还没定下来的 Design `docs/design/cart-storage.md` 都链接了 T-3。

## 完整路径

1. 删除 T-3。 {#remove}

2. 检查。 {#check}

   ```sh
   concord --json check
   ```

   预期输出，退出 1：

   ```json
   {"operation":"check","ok":false,"complete":true,"findings":[{"code":"AnchorNotFound","path":"docs/design/cart-storage.md","line":9,"message":"Taste entry t-3 does not exist","category":"relation"},{"code":"AnchorNotFound","path":"docs/feature/cart/README.md","line":14,"message":"Taste entry t-3 does not exist","category":"relation"}]}
   ```

   Feature 与 Design 都被报告。Design 也只写现在，和其它页面一样检查。

3. 改写两页中依据 T-3 的句子，改为链接仍适用的条目或删去链接，再检查。 {#rewrite}

   预期输出以 `ok: true` 开头，退出 0。

## 结果

`docs/` 下的页面不留下指向已删除条目的链接。

## Spec 来源

- [文件格式](../format.md#链接)
- [命令](../cli.md#错误与-finding)
