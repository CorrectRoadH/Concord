# 在工作台查看 Spec 的实现与测试

## 用户目标

维护者想知道一个 Feature 由哪些代码实现、有哪些测试，能跳到具体源码行，为新代码补上关联，并运行关联的测试看结果。

## 起始状态

- `concord view` 正在运行，浏览器打开了它显示的地址。
- `concord.config.ts` 配置了 `sourceRoots`、`testRoots` 与 `runner`。
- `src/cart.ts` 带有指向 `docs/feature/cart/README.md` 的代码声明，`test/cart.test.ts` 带有 `@feature docs/feature/cart/README.md` 标记。

## 完整路径

1. 打开 Feature 的「实现」页签。 {#implementation}

   进入 Feature「cart」，点「实现」：

   ```text
   实现                                   添加关联
   cart
   1 处实现 · 1 个文件
   checkout
   类／函数
   src/cart.ts · 第 3–5 行
   关联 Spec：
   docs/feature/cart/README.md
   ```

   实现按 Feature 与各个 Use Case 分组，汇总 Feature 自身、附页与所属 Use Case 的关联。条目的排版见[实现与测试](../ui.md#实现与测试)。

2. 打开源码位置。 {#source}

   点「src/cart.ts · 第 3–5 行」，右侧抽屉打开源码，滚动到声明的起始行并突出它；地址变为：

   ```text
   /features/cart?tab=implementation&source=src%2Fcart.ts&sourceLine=3&sourceEndLine=5
   ```

   这个地址可以分享或刷新，仍打开同一位置。实现源码可以在抽屉里编辑，走受管的保存入口；测试源码只读。关闭抽屉回到原来的页签与文件，外层的 Feature 页面不重新加载。

3. 为新代码添加关联。 {#associate}

   点「添加关联」，弹出「生成代码归属注释」：

   ```text
   生成代码归属注释
   返回可粘贴的关联注释片段，不直接改写源码。
   关联目标   cart
   Scope      Node / File / Region
   Spec 引用  每行一个；支持 supporting page 与 #anchor
   取消  生成
   ```

   选择 scope 与目标 Spec 后点「生成」，把生成的注释粘贴到源码中。注释不含声明 ID。

4. 查看「测试」页签。 {#tests}

   ```text
   测试                                   生成注释
   测试声明：1 项；声明不表示覆盖率或功能完成。
   docs/feature/cart/README.md#0
   active
   test/cart.test.ts:1
   ▸ 声明详情
   ```

   列表来自测试源码里写的 Feature / Use Case 标记；列出测试不会执行它。点「test/cart.test.ts:1」同样在抽屉中打开源码。

5. 运行测试，需要时取消。 {#run}

   预期输出：在测试条目上运行它，条目内显示任务状态，依次经过排队、运行，最后成功或失败；失败时显示诊断。运行中可以取消，Concord 确认测试的进程组已经退出后，才开始下一个任务。任务状态的完整列表见[编辑与执行生命周期](../architecture.md#编辑与执行生命周期)。

## 结果

实现与测试关系都从源码中的声明推导，工作台不另存关系。命令结果不等于原生测试覆盖的证明。

| 情形 | 看到什么 |
| --- | --- |
| 同一段代码关联多个 Spec | 出现在每个关联分组中，各组的统计只算本组 |
| 尚未配置源码目录 | 「尚未建立实现关联」，并提示配置源码目录、添加归属注释 |
| 某个分组没有声明 | 引导接入，不用测试文件代替实现 |
| Engineering 详情 | 有同样的实现列表、添加关联与源码跳转，没有测试页签 |
| 没有任务在运行 | 测试任务槽位为 `absent` |
| 运行中 | 可以查询与取消；取消后可以再次成功运行 |
| 无法确认进程组已清理 | 明确阻断后续操作，保留诊断 |
| 运行 | 遵守项目 runner 的授权范围 |
