// @concord-file
// @concord-implements docs/feature/cross-platform-release/use-case/release-from-tag.md
import { NodeRuntime, NodeServices } from '@effect/platform-node';
import { Effect, FileSystem, Schema } from 'effect';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const Version = Schema.String.check(Schema.isPattern(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u));
const ReleaseTag = Schema.String.check(Schema.isPattern(/^(?:concord-)?v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u));
const Package = Schema.Struct({ name: Schema.Literal('concord-sdlc'), version: Version });
const Mod = Schema.Struct({ place: Schema.Literal('right'), size: Schema.Number, minimumConcordVersion: Version,
  overlay: Schema.optional(Schema.Struct({ width: Schema.Number, height: Schema.Number })) });

export class HerdrModReleaseInvalid extends Schema.TaggedError<HerdrModReleaseInvalid>()('HerdrModReleaseInvalid', {
  message: Schema.String,
}) {}

function recipe(version: string): string {
  return `# Concord

在 coding agent 旁边读写项目 Spec：左侧文档树，右侧 Markdown 正文、关联测试与代码，保存后显示检查结果。

![Concord](preview.png)

## What you see

面板默认在右侧，宽 760px。顶部是 Concord、选择目录、刷新和新建 Feature；下面显示项目路径或错误。左栏宽 220px，按 Feature 与 Use Case、品味、术语、Issue、Memory、其它文档分组；右栏显示正文、测试与实现位置。整体内边距 10px、列间距 10px、正文 13px；背景、文字和错误分别取 Herdr 的 surface、foreground、blocked 主题颜色。

## How it behaves

打开 Concord 命令时聚焦同一 tab 的已有面板，或在当前 pane 右侧分屏；没有 pane 时显示目录选择浮层。缺少 CLI 或 CLI 低于 ${version} 时只显示安装或升级说明及“重新检测”。较新 CLI 可以使用，并提示用 concord herdr install 更新 mod。选择 Git 仓库后，空项目可初始化并阅读推荐写作指南；文档点击后渲染 Markdown，术语链接显示定义，测试与代码位置可预览。编辑保存后运行检查；文件冲突保留草稿并提供磁盘版本供合并。监听文件变化后刷新，监听不可用时轮询；切换目录和关闭面板时回收任务、监听与编辑器。此面板不显示 agent 的 working、blocked、done、idle 状态，不定义快捷键或悬停动作。

## Built from

mods/concord/main.js 是安装包内构建好的原生 Herdr View，依赖 gpui-kit、gpui-base 和 herdr，不使用网页视图或内置 mod。mod.json 声明 place=right、size=760、minimumConcordVersion=${version}；NOTICE.txt 保留捆绑依赖许可证。View 使用 v_flex、h_flex、TextView、Editor、Input；props.cwd 指定项目目录，props.overlay 标识打开命令的浮层。通过 focused、panes、spaces 确定目录，调用 pane.focus、pane.split、closeOverlay 管理面板，使用 pickFolder、watchFolder、readTextFile、writeTextFile、appHome、theme。exec 运行 concord --version 和公开 CLI 查询及写入命令，包括 --json doctor、init、list、show、concepts index、taste、check、new feature 以及 --skill。截图来自同一安装包的 dist/herdr-mod/preview.png，是在真实 Herdr 主机上截取的界面，不生成占位图。

## Watch out

先读 Herdr 配置目录的 AGENTS.md 和所有 mod 文件，向用户说明会运行 concord 并读写当前项目文件；mod 自身不发网络请求。需要 PATH 上的 Concord >= ${version}，安装命令为 curl -fsSL https://github.com/CorrectRoadH/Concord/releases/latest/download/install.sh | sh；Homebrew 与 Nix 安装方式见 Concord README。读取源码标签对应的 src/entry/herdr-mod/ 来重建，使用固定 pnpm 工具链构建安装包，保留原生 Herdr 导入和 NOTICE。只复制 mods/concord/ 到用户 mods 目录，名称冲突时按 Herdr 指南调整；不复制本说明和预览，不修改布局或快捷键。没有 Git 目录时先选择目录。p5 动画通过“在浏览器中播放”打开，面板只显示说明与源码。

## Done when

对复制后的目录运行 herdr-app check；打开 Concord，核对右侧面板及目录选择；验证未安装或过旧 CLI 时的提示、重新检测、空 Git 仓库初始化及指南、文档与关联测试和代码的阅读、编辑保存与检查、外部文件变化刷新及冲突草稿保留。用 herdr-app shot 在真实主机截图并实际查看。卸载只删除该 mod 目录，用户布局和快捷键保持原样。
`;
}

/** The input is an extracted release package; the output is an existing mirror repository root. */
export const prepareHerdrModMirror = Effect.fn('prepareHerdrModMirror')(function*(packageRoot: string, mirrorRoot: string, tag: string) {
  const fs = yield* FileSystem.FileSystem;
  const input = resolve(packageRoot), output = resolve(mirrorRoot, 'concord');
  const within = (parent: string, child: string) => { const path = relative(parent, child); return path === '' || !path.startsWith('..') && !isAbsolute(path); };
  if (within(input, output) || within(output, input)) return yield* new HerdrModReleaseInvalid({ message: 'Package input and mirror output must not overlap' });
  const releaseTag = yield* Schema.decodeUnknownEffect(ReleaseTag)(tag);
  const manifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Package), { onExcessProperty: 'ignore' })(yield* fs.readFileString(join(input, 'package.json')));
  const assets = join(input, 'dist/herdr-mod');
  const mod = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Mod), { onExcessProperty: 'error' })(yield* fs.readFileString(join(assets, 'mod.json')));
  if (manifest.version !== releaseTag.replace(/^(?:concord-)?v/u, '') || mod.minimumConcordVersion !== manifest.version) {
    return yield* new HerdrModReleaseInvalid({ message: 'Release tag, package version and minimumConcordVersion must agree' });
  }
  for (const name of ['main.js', 'mod.json', 'NOTICE.txt', 'preview.png']) {
    const path = join(assets, name);
    if (!(yield* fs.exists(path)) || (yield* fs.stat(path)).type !== 'File' || (yield* fs.readLink(path).pipe(Effect.option))._tag === 'Some') {
      return yield* new HerdrModReleaseInvalid({ message: `Missing or invalid packaged Herdr asset: ${name}` });
    }
    if ((yield* fs.readFile(path)).length === 0) return yield* new HerdrModReleaseInvalid({ message: `Empty packaged Herdr asset: ${name}` });
  }
  const preview = yield* fs.readFile(join(assets, 'preview.png'));
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => preview[index] === value)) {
    return yield* new HerdrModReleaseInvalid({ message: 'Packaged preview.png must have a PNG signature' });
  }
  // Stage locally before replacing the owned mod directory. Other repository paths stay intact.
  const stage = yield* fs.makeTempDirectoryScoped({ prefix: 'concord-herdr-mirror-' });
  const stagedMod = join(stage, 'mod');
  yield* fs.makeDirectory(stagedMod);
  for (const name of ['main.js', 'mod.json', 'NOTICE.txt']) yield* fs.copyFile(join(assets, name), join(stagedMod, name));
  const target = join(output, 'mods/concord');
  yield* fs.makeDirectory(join(output, 'mods'), { recursive: true });
  yield* fs.remove(target, { recursive: true, force: true });
  yield* fs.copy(stagedMod, target);
  yield* fs.writeFileString(join(output, 'RECIPE.md'), recipe(manifest.version));
  yield* fs.writeFile(join(output, 'preview.png'), preview);
  return { version: manifest.version, directory: output };
}, Effect.scoped, Effect.mapError(cause => cause instanceof HerdrModReleaseInvalid ? cause : new HerdrModReleaseInvalid({ message: String(cause) })));

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  Effect.gen(function*() {
    const args = yield* Schema.decodeUnknownEffect(Schema.Tuple([Schema.String, Schema.String, Schema.String]))(process.argv.slice(2));
    const result = yield* prepareHerdrModMirror(...args);
    yield* Effect.sync(() => process.stdout.write(`Prepared Concord Herdr mod ${result.version}: ${result.directory}\n`));
  }).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
