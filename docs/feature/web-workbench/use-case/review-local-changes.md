# 查看本地未提交变更

## 用户目标

开发者在提交前想看清有哪些未提交的改动：哪些文件变了、改动是否已暂存、新加了哪些测试声明，不用在终端里来回切换 `git status` 与 `git diff`。

## 起始状态

- 项目目录是一个 Git worktree，已用 `concord init` 初始化。
- 项目目录中有未提交的改动，例如修改了 `docs/feature/cart/README.md`，新增了带 `@feature docs/feature/cart/README.md` 标记的 `test/cart.test.ts`。

## 完整路径

1. 启动工作台并打开它显示的地址。 {#open}

   ```sh
   concord view
   ```

   ```text
   Concord view
   Root: /home/me/shop
   Host: 127.0.0.1  Port: 4317

     Local:   http://127.0.0.1:4317/
   ```

   浏览器进入「Git 变更」，内容导航列出全部未提交的文件：

   ```text
   Git 变更
   全部 2   文档 1   测试用例 1

   变更文件 · 2
   docs
     feature
       cart
         README.md      M
   test
     cart.test.ts       A
   ```

2. 选择一个文件，阅读差异。 {#read}

   点 `README.md`，右侧显示它的差异，可以在「分栏」与「统一」之间切换：

   ```text
   docs/feature/cart/README.md
   未暂存
   分栏  统一
   docs/feature/cart/README.md → docs/feature/cart/README.md   modify
   29	29	 Add pages for public behavior …
   	30	
   	31	## 结算
   	32	
   	33	购物车可以一次结算全部商品。
   ```

   已暂存的差异比较 HEAD 与 index，未暂存的差异比较 index 与 worktree 中的文件，未跟踪的文件显示新文件内容。同一个文件暂存后又被编辑时，标题下同时出现「已暂存」与「未暂存」，点击切换。

3. 只看文档或测试。 {#filter}

   「文档」只列出 `docs/` 下的变更，包括重命名前或重命名后位于 `docs/` 的文件。「测试用例」按已配置的测试根列出相对 HEAD 新增的测试声明，每条声明挂在所属文件下并给出源码行：

   ```text
   变更文件 · 1
   test
     cart.test.ts       A
       docs/feature/cart/README.md#0
       + L1
   新增声明列在所属文件下；diff 按文件展示。
   ```

   每个筛选分别记住选中的文件与阅读位置，切回来时回到原处。

4. 修改文件后刷新。 {#refresh}

   在编辑器里继续修改后，点击「刷新」。原来选中的文件已经没有变更时，页面改选一个仍有变更的文件；全部提交后显示「没有未提交变更」与「没有可审阅的变更」。

5. 从侧栏进入 Spec 或文档继续工作。 {#continue}

   点击侧栏的 Feature、「文档」等入口打开对应页面编辑，编辑遵守[自动保存](../ui.md#自动保存)的摘要保护。文档页标题旁的「查看 Git 变更」回到这个文件的差异。

## 结果

页面只读取 Git，不执行暂存、提交或 push。分类、文件、区域与差异布局都写在 URL 里，复制链接或刷新后回到同一位置。

| 情形 | 看到什么 |
| --- | --- |
| 暂存后继续编辑 | 同一文件同时有「已暂存」与「未暂存」，可分别查看 |
| 新增、删除、重命名、模式变化 | 文件旁标出对应状态，差异明确展示这种变化 |
| 冲突、二进制文件、特殊字符文件名 | 明确展示 |
| 未跟踪的符号链接 | 不读取链接目标 |
| 大文件 | 明确标注预览限制 |
| 新增的测试声明 | 只列出声明与源码位置，不标为已经运行或通过 |
| 手机屏幕 | 文件列表收进内容导航抽屉 |
