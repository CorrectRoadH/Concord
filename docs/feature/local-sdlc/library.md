# 库接口

库以独立的 npm 包 `concord-sdlc` 发版，供配置文件、测试 adapter 与 PR 预览的消费者导入。它只含库，没有 `concord` 命令；运行 CLI 不需要它，CLI 从[发版归档](../cross-platform-release/README.md)安装。文档与标记的写法见[文档与标记格式](format.md)。

## 安装

库包附在每个 GitHub Release 中，文件名为 `concord-sdlc-<version>.tgz`。用项目自己的包管理器从精确 URL 安装为开发依赖，`<version>` 取与 CLI 相同的版本：

```sh
npm install -D https://github.com/CorrectRoadH/Concord/releases/download/v0.9.0/concord-sdlc-0.9.0.tgz
```

pnpm、yarn 与 bun 用各自的添加开发依赖命令安装同一 URL。只为 `concord.config.ts` 获得类型检查时，安装它是可选的；运行解码器的脚本或 adapter 需要自己的 JavaScript 运行时。

## 导出

包只导出以下四个子路径，每个子路径带 JavaScript 入口与类型声明。其余模块是内部实现，不导出。

| 子路径 | 导出 | 用途 |
| --- | --- | --- |
| `concord-sdlc/config` | `concord.config.ts` 的类型 `ProjectConfig`，不依赖 Effect | 项目配置获得类型检查；字段与校验错误见[维护项目配置](../project-onboarding/use-case/maintain-project-config.md) |
| `concord-sdlc/model` | 文档 Schema 与模型类型 | 脚本严格解码 `--json` 输出中的文档与关系结构 |
| `concord-sdlc/test-adapter-protocol` | 原生测试 adapter 的协议 Schema | 外部 adapter 解码请求并编码响应；消息与失败见[adapter 协议](cli.md#adapter-协议) |
| `concord-sdlc/change-preview` | PR 静态预览产物的 Schema 与解码器 | 部署前核对 `changes.json`，见 [Web 工作台库接口](../web-workbench/library.md) |

```ts
import type { ProjectConfig } from 'concord-sdlc/config';

export default {
  testRoots: ['test'],
  sourceRoots: ['src'],
} satisfies ProjectConfig;
```

其余子路径的 Schema 严格解码：未知字段、错误类型与未知版本都失败，失败带具名错误与字段路径。子路径只导出类型、Schema 与纯解码函数，导入它们不读取文件、不启动进程，也不打开缓存。

## 版本

库包的版本与同一 Release 的 CLI 版本相同，两者由同一个标签发版。项目应安装与所用 CLI 相同版本的库包。

`concord doctor` 从项目目录读取已安装的 `node_modules/concord-sdlc/package.json`。版本与 CLI 不同时，`findings` 包含一项 `LibraryVersionMismatch`，`nextSteps` 给出安装同版本库包的命令；没有安装库包时不报告。该 finding 不改变 `ok`。

```json
{
  "code": "LibraryVersionMismatch",
  "path": "node_modules/concord-sdlc/package.json",
  "message": "concord-sdlc 0.8.1 does not match Concord 0.9.0. Run: npm install -D https://github.com/CorrectRoadH/Concord/releases/download/v0.9.0/concord-sdlc-0.9.0.tgz"
}
```
