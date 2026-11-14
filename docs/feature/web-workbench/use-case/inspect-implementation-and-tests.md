# 在工作台查看 Spec 的实现与测试

## 用户目标

维护者想知道一个 Feature 由哪些代码实现、有哪些测试，能跳到具体源码行，为新代码补上关联，并查看具体用例和 label，把验证上下文交给 coding agent。

## 起始状态

- `concord view` 正在运行，浏览器打开了它显示的地址。
- `concord.config.ts` 按约定发现或配置了 `sourceRoots` 与 `testRoots`；原生清单来自显式 `test discover`。
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

5. 查看具体用例，交给 agent 验证。 {#inspect-native}

   详情使用 [`test show` 的绑定投影](../../local-sdlc/cli.md#具体用例绑定输出)，展示原生身份、label、来源范围和能力缺口。没有当前清单时显示未知或过期，不重新收集，不用相似名称猜测绑定。

   需要验证行为时，将当前项目目录、Spec 引用、测试源码位置与原生身份复制给 agent，按[项目验证流程](../../local-sdlc/use-case/validate-change-with-project-tools.md)处理。工作台没有测试运行按钮、测试结果面板或测试任务创建与取消 API。



## 结果

实现与测试关系都从源码中的声明推导，工作台不另存关系。收集清单与绑定不等于测试通过或覆盖证明。

| 情形 | 看到什么 |
| --- | --- |
| 同一段代码关联多个 Spec | 出现在每个关联分组中，各组的统计只算本组 |
| 尚未配置源码目录 | 「尚未建立实现关联」，并提示配置源码目录、添加归属注释 |
| 某个分组没有声明 | 引导接入，不用测试文件代替实现 |
| Engineering 详情 | 有同样的实现列表、添加关联与源码跳转，没有测试页签 |
| 有当前收集观察 | 展示绑定的具体用例、label、范围与能力缺口 |
| 没有或过期的清单 | 明确标记未知或过期，保留静态关系 |
| 显式绑定冲突 | 展示 gap，不重新推导或启动测试 |
| 关闭页面 | 不影响 agent 独立运行的项目测试 |
