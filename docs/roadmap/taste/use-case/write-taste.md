# 写下项目的第一条品味

## 用户目标

维护者想把项目对“什么是好的”的判断写下来，让人和 agent 按同一个标准选择。

## 起始状态

- 项目已初始化，`docs/taste.md` 只有标题和说明，没有条目。

## 完整路径

1. 打开 `docs/taste.md`，写下一条品味。

   ```markdown
   ## T-1 读得懂胜过写得全 {#t-1}

   Spec 没人看得懂，就没人认真审阅，也就没人维护。

   - 好的样子：README 像使用教程，先讲能做什么，再给一个照着就能运行的例子。
   - 坏的样子：README 开头就是字段、退出码和边界条件。
   ```

2. 写一条 Decision Memory，说明为什么写下这条品味。

   ```markdown
   ---
   type: decision
   status: current
   relations:
     - role: changes
       target: docs/taste.md
   ---

   # 写下项目的第一条品味
   ```

   正文写适用范围、理由、来源与影响。

3. 查看品味。

   ```sh
   concord taste
   ```

   预期输出：

   ```text
   T-1 读得懂胜过写得全
     (没有页面依据这一条)
   ```

4. 提交前检查本次变化。

   ```sh
   concord check --since master
   ```

   预期输出以 `ok: true` 开头，退出 0。

## 结果

`docs/taste.md` 有了第一条品味，它从这一刻起生效，不需要另外“启用”。修改记录在 Memory 中。

## Spec 来源

- [文件格式](../format.md)
- [命令](../cli.md)
