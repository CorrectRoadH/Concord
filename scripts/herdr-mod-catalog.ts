// @concord-file
// @concord-implements docs/engineering/build/use-case/share-herdr-mod.md
import { Effect, FileSystem, Schema } from 'effect';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { ModVersion } from '../src/model/herdr-mod/index.ts';

const Mod = Schema.Struct({ place: Schema.Literal('right'), size: Schema.Number, minimumConcordVersion: ModVersion,
  overlay: Schema.optional(Schema.Struct({ width: Schema.Number, height: Schema.Number })) });

export class HerdrModCatalogInvalid extends Schema.TaggedError<HerdrModCatalogInvalid>()('HerdrModCatalogInvalid', {
  message: Schema.String,
}) {}

function recipe(version: string): string {
  const incompatible = version === 'dev' ? '缺少 CLI' : `缺少 CLI 或 CLI 低于 ${version}`;
  const required = version === 'dev' ? 'Concord（使用最新发布版本）' : `Concord >= ${version}`;
  return `# Concord

在 coding agent 旁边读写项目 Spec：左侧文档树，右侧 Markdown 正文、关联测试与代码，保存后显示检查结果。

![Concord](preview.png)

## What you see

面板默认在右侧，宽 760px。顶部是 Concord、次要色的仓库地址与“新建 Feature”。左栏宽 220px，按 Feature 与 Use Case、品味、术语、Issue、Memory、其它文档分组；右栏显示正文、测试与实现位置。整体内边距 10px、列间距 10px、正文 13px；背景与文字取 Herdr 的 surface、foreground 主题颜色。状态页居中显示标题、次要说明及至多一个主按钮；进程输出折叠在详情中。

## How it behaves

打开 Concord 命令时聚焦同一 tab 的已有面板，或在当前 pane 右侧分屏；没有终端时提示先在这个 tab 里打开一个终端。${incompatible} 时只显示安装或升级说明及“重新检测”。较新 CLI 可以使用，并提示用 concord herdr install 更新 mod。面板跟随同一 tab 最近聚焦终端的目录与机器，根目录不变时不重新加载，有草稿时等保存或放弃后切换。空项目可初始化并阅读推荐写作指南；文档点击后渲染 Markdown，术语链接显示定义，测试与代码位置可预览。编辑保存后运行检查；文件冲突保留草稿并提供磁盘版本供合并。本机与远程都通过 Concord CLI 读写；前台通过 workspace wait 等待变化，服务不可用时每两秒重读，后台停止等待，回前台立即刷新。切换仓库和关闭面板时回收任务与编辑器。此面板不显示 agent 的 working、blocked、done、idle 状态，不定义快捷键或悬停动作。

## Built from

mods/concord/main.js 是从源码构建的原生 Herdr View，依赖 gpui-kit、gpui-base 和 herdr，不使用网页视图或内置 mod。mod.json 声明 place=right、size=760、minimumConcordVersion=${version}；NOTICE.txt 保留捆绑依赖许可证。View 使用 v_flex、h_flex、TextView、Editor、Input；props.overlay 标识打开命令的浮层。通过 focused、panes、spaces 确定目录，调用 pane.focus、pane.split、closeOverlay 管理面板，通过 theme 跟随主题。exec 在终端所在机器运行 concord --version 和公开 CLI 查询及写入命令，包括 --json doctor、init、list、show、concepts index、taste、check、new feature 以及 --skill、action file.get/document.set、workspace wait。截图来自 src/entry/herdr-mod/preview.png，是在真实 Herdr 主机上截取的界面，不生成占位图。

## Watch out

先读 Herdr 配置目录的 AGENTS.md 和所有 mod 文件，向用户说明会运行 concord 并读写当前项目文件；mod 自身不发网络请求。需要 PATH 上的 ${required}，安装命令为 curl -fsSL https://github.com/CorrectRoadH/Concord/releases/latest/download/install.sh | sh；Homebrew 与 Nix 安装方式见 Concord README。读取 src/entry/herdr-mod/ 来重建，使用固定 Bun 工具链运行 bun run build:herdr，保留原生 Herdr 导入和 NOTICE。只复制 mods/concord/ 到用户 mods 目录，名称冲突时按 Herdr 指南调整；不复制本说明和预览，不修改布局或快捷键。没有 Git 目录时，在同一 tab 的终端里 cd 到仓库。

## Done when

对复制后的目录运行 herdr-app check；打开 Concord，核对右侧面板跟随同一 tab 的终端与远程机器；验证未安装或过旧 CLI 时的提示、重新检测、空 Git 仓库初始化及指南、文档与关联测试和代码的阅读、编辑保存与检查、外部文件变化刷新及冲突草稿保留。用 herdr-app shot 在真实主机截图并实际查看。卸载只删除该 mod 目录，用户布局和快捷键保持原样。
`;
}

/** Validate all generated inputs before replacing the owned catalog directory. */
export const prepareHerdrModCatalog = Effect.fn('prepareHerdrModCatalog')(function*(assetsRoot: string, mirrorRoot: string, version: string) {
  const fs = yield* FileSystem.FileSystem;
  const input = resolve(assetsRoot), output = resolve(mirrorRoot, 'concord');
  const within = (parent: string, child: string) => { const path = relative(parent, child); return path === '' || !path.startsWith('..') && !isAbsolute(path); };
  if (within(input, output) || within(output, input)) return yield* new HerdrModCatalogInvalid({ message: 'Asset input and catalog output must not overlap' });
  const minimum = yield* Schema.decodeUnknownEffect(ModVersion)(version);
  const assets = input;
  const mod = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Mod), { onExcessProperty: 'error' })(yield* fs.readFileString(join(assets, 'mod.json')));
  if (mod.minimumConcordVersion !== minimum) {
    return yield* new HerdrModCatalogInvalid({ message: 'Build version and minimumConcordVersion must agree' });
  }
  for (const name of ['main.js', 'mod.json', 'NOTICE.txt', 'preview.png']) {
    const path = join(assets, name);
    if (!(yield* fs.exists(path)) || (yield* fs.stat(path)).type !== 'File' || (yield* fs.readLink(path).pipe(Effect.option))._tag === 'Some') {
      return yield* new HerdrModCatalogInvalid({ message: `Missing or invalid packaged Herdr asset: ${name}` });
    }
    if ((yield* fs.readFile(path)).length === 0) return yield* new HerdrModCatalogInvalid({ message: `Empty packaged Herdr asset: ${name}` });
  }
  const preview = yield* fs.readFile(join(assets, 'preview.png'));
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => preview[index] === value)) {
    return yield* new HerdrModCatalogInvalid({ message: 'Packaged preview.png must have a PNG signature' });
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
  yield* fs.writeFileString(join(output, 'RECIPE.md'), recipe(minimum));
  yield* fs.writeFile(join(output, 'preview.png'), preview);
  return { version: minimum, directory: output };
}, Effect.scoped, Effect.mapError(cause => cause instanceof HerdrModCatalogInvalid ? cause : new HerdrModCatalogInvalid({ message: String(cause) })));
