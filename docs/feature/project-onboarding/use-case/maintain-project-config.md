# 安全维护项目配置

## 用户目标

维护者只在需要原生收集或偏离约定时写配置，获得 TypeScript 类型提示，并保持读取、编辑、验证和恢复行为一致。

## 起始状态

- 项目已初始化，没有 `concord.config.ts`；测试在 `spec/`，实现在 `src/`。
- 文件语法见[项目配置文件](../format.md)。

### 配置项

没有 `concord.config.ts` 时全部配置项取默认值。每一项的默认值与何时需要配置见[配置项](../format.md#配置项)。

## 完整路径

1. 看实际生效的配置，决定要不要写。 {#effective}

   ```sh
   concord doctor
   ```

   输出（节选）：

   ```text
   configuration:
     testRoots: none
     sourceRoots: 
       src
   missingTestRoots: none
   missingSourceRoots: none
   ```

   默认值够用就不写配置。本例没有 `test/` 或 `tests/`，`testRoots` 为空，`spec/` 中的测试不会被发现，需要覆盖 `testRoots`。

2. 直接创建 `concord.config.ts`。 {#write}

   ```ts
   export default {
     testRoots: ['spec'],
   };
   ```

   再运行 `concord doctor`：

   ```text
   configuration:
     testRoots: 
       spec
     sourceRoots: 
       src
   ```

   显式的 `testRoots` 替换默认值，只发现 `spec/`。Concord 只静态读取这个文件，不执行它；编辑器可用 `concord schema config` 输出的 JSON Schema 补全与校验。

3. 写错时看到具名错误，原文不变。 {#invalid}

   ```ts
   export default { testRoots: ['spec'], extra: 1 };
   ```

   ```text
   ok: false
   error: InvalidData
   message: concord.config.ts: Expected no excess property
     at ["extra"]
   ```

   写成运行时表达式，例如 `export default { testRoots: discoverTestRoots() };`：

   ```text
   ok: false
   error: InvalidConfigSyntax
   message: concord.config.ts: runtime expressions are not permitted in static configuration
   ```

4. 在 Web 工作台的设置页修改。 {#web}

   设置页显示配置原文与摘要。保存时以 `config.set` action 按读取时的原文作为前像提交；这期间文件被外部编辑过，保存被拒绝，不覆盖外部编辑。

5. 新命令读取新配置。 {#reload}

   之后运行的命令使用新配置；已有文档不被隐式重写。

6. 写入被中断时恢复。 {#recover}

   ```sh
   concord recover
   ```

   恢复按写入开始时冻结的配置快照授权，不依据外部新写入的配置扩大权限。

## 结果

| 情形 | 结果 |
| --- | --- |
| 没有配置的仓库 | `test/` 与 `src/` 下的标记被发现 |
| 配置了 `testRoots` | 只发现配置的根 |
| 重复键、spread、调用等运行时表达式，或不安全路径 | 返回 `InvalidConfigSyntax` 或 `InvalidData`，不执行消费者代码，保留原文 |
| 配置中出现未列出的字段 | 返回 `InvalidData`，保留原文 |
| JS 调用方绕过类型传入非法配置 | 同样拒绝 |
| 保存时文件已被外部编辑 | 拒绝覆盖；比较与提交使用同一次读取的原文 |
| `config.set` 保存 | 可以把 TS 全文规范化；恢复时逐字节还原 |
| init 配置发布、`config.set` 发布或源码写入在前后任一处中断 | 都能恢复；恢复再次中断可以重试 |
| journal 无法解码，或与外部编辑冲突 | 遵循工作区文件为准，清理陈旧 journal 并输出警告，不阻断读写 |
| 配置畸形或品味文件缺失时运行 `recover` | 不阻断 `recover`，恢复也不覆盖未知内容 |

拒绝时配置、journal、锁、事务目标与临时文件都保持原样，见[校验错误](../format.md#校验错误)。快照与恢复授权的实现见[架构](../architecture.md)。
