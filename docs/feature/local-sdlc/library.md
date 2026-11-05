# 库接口

安装包除 `concord` 命令外导出四个子路径，供配置文件、测试 adapter 与 PR 预览的消费者导入。其余模块是内部实现，不导出。文档与标记的写法见[文档与标记格式](format.md)。

| 子路径 | 导出 | 用途 |
| --- | --- | --- |
| `concord-sdlc/config` | `concord.config.ts` 的类型 `ProjectConfig`，不依赖 Effect | 项目配置获得类型检查；字段与校验错误见[维护项目配置](../project-onboarding/use-case/maintain-project-config.md) |
| `concord-sdlc/model` | 文档 Schema 与模型类型 | 脚本严格解码 `--json` 输出中的文档与关系结构 |
| `concord-sdlc/test-adapter-protocol` | 原生测试 adapter 的协议 Schema | 外部 adapter 解码请求并编码响应；消息与失败见[原生 adapter 协议](use-case/run-native-test-adapters.md#协议) |
| `concord-sdlc/change-preview` | PR 静态预览产物的 Schema 与解码器 | 发布前核对 `changes.json`，见 [Web 工作台库接口](../web-workbench/library.md) |

```ts
import type { ProjectConfig } from 'concord-sdlc/config';

export default {
  testRoots: ['test'],
  sourceRoots: ['src'],
} satisfies ProjectConfig;
```

其余子路径的 Schema 严格解码：未知字段、错误类型与未知版本都失败，失败带具名错误与字段路径。子路径只导出类型、Schema 与纯解码函数，导入它们不读取文件、不启动进程，也不打开缓存。
