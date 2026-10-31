# 修改品味

## 用户目标

维护者发现一条品味需要补充或改写，希望改完就生效，以后能查到改了什么。

## 起始状态

- `docs/taste.md` 中有 `T-1`，Feature `cart` 链接了它。

## 完整路径

1. 直接编辑 `docs/taste.md` 中的 T-1。

   例如在好的样子里加一句：“功能在不同情形下的表现各写成一个 Use Case。”

2. 提交。理由写在提交说明里。

   ```sh
   git commit -am "taste: T-1 adds per-situation Use Cases"
   ```

3. 检查。

   ```sh
   concord check
   ```

   预期输出以 `ok: true` 开头，退出 0。

## 结果

品味文件只保存当前正文。改了什么、为什么改，由 Git 历史回答，Concord 不另存修改记录。

## Spec 来源

- [文件格式](../format.md)
