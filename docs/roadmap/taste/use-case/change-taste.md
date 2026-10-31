# 修改品味并记下理由

## 用户目标

维护者发现一条品味需要补充或改写，希望修改后别人能查到为什么改。

## 起始状态

- `docs/taste.md` 中有 `T-1`，Feature `cart` 链接了它。

## 完整路径

1. 直接编辑 `docs/taste.md` 中的 T-1。

   例如在好的样子里加一句：“功能在不同情形下的表现各写成一个 Use Case。”

2. 在同一变化中写一条 Decision Memory，以 `changes` 指向 T-1。

   ```markdown
   ---
   type: decision
   status: current
   relations:
     - role: changes
       target: docs/taste.md#t-1
   ---

   # T-1 增加 Use Case 的好坏对照
   ```

   正文写适用范围、理由、来源与影响。

3. 检查本次变化。

   ```sh
   concord check --since master
   ```

   预期输出以 `ok: true` 开头，退出 0。

## 结果

品味文件只保存修改后的正文；为什么改，记录在 Memory 中，逐字差异由 Git 提供。

## Spec 来源

- [文件格式](../format.md#修改记录)
