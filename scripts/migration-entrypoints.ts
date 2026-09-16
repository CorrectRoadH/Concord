import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Change } from '../src/shared.js';

const feedbackMemoryGuide = `# Feedback 与 Memory

Research、Memory 和本地 Issue 统一使用 Concord 最新文档模型。类型与严格 Schema 由锁定包的 \`concord-sdlc/model\` 导出。普通命令只读写 \`concord.document/v1\`，不读取旧格式或维护历史兼容列表。

## Feedback

本地观察的唯一 owner 是 \`docs/issues/<id>.md\`，\`pnpm feedback\` 与 Concord 页面读取同一批文件。旧 \`feedback/<id>/README.md\` 已通过一次性移动迁出，不保留第二份 owner。\`origin\` 保留 dev／dogfood provenance，\`source\` 仅保存实际 GitHub／Linear 远端provenance快照，二者不互相冒充。

\`memoryRelations\` 条目 investigation、root-cause、decision、delivery 角色和 canonical Memory 路径。\`adoptions.current/history\` 保存精确契约引用及退役历史。反向关系统一派生，不另建注册表。

### 关闭规则

\`closure\` 保存 fixed、delivered、duplicate、declined、invalid、external-fixed 或普通 closed 原因。fixed 关联已条目 fixed resolution 的 Problem；delivered 关联交付 Memory 与已采用目标；declined 关联当前 Decision；duplicate 指向唯一 canonical Issue。duplicate／declined／invalid 前须明确退役 current adoptions。历史关闭声明不会生成新的执行证据。后续问题重开不静默改写 Issue 历史。

\`pnpm feedback close --help\` 给出各 kind 的具名参数。新公开工作项由 Issue 流程处理；本地创建、关闭或同步都不授权远端写入。

### 远端接入

在消费仓库配置 GitHub 读取范围：

\`\`\`sh
pnpm exec concord feedback connection add --id niceeval-github --provider github --owner NiceEval --repo NiceEval --credential-env GITHUB_TOKEN
\`\`\`

凭据只引用进程变量名。\`pnpm exec concord feedback sync --connection niceeval-github\` 显式读取远端。同步不是发布 GitHub Issue，历史 dev／dogfood 也不会被伪造为远端 Issue。

## Memory

\`memory/<id>.md\` 保存 Problem、Decision、Insight 或 Note；\`memory/INDEX.md\` 是人读导航，机器发现来自 owner metadata。类型明确但当前状态未知时保存 captured，不能默认断言已采用或仍开放。Note 只允许 captured；具名 \`memory activate --reason\` 可将已分类条目激活为 open 或 current。captured 不满足 fixed 或 promotion 门槛。

Problem 可为 open、\`resolved\`、captured 或 superseded；Decision／Insight 可为 current、captured 或 superseded。superseded 表示已不再适用，不表示已修复。未知替代目标保留原声明和provenance，不猜测正文中任意链接。

### 作者区域

最新 frontmatter 拥有状态、关系、epoch 和历史；正文是完整作者区域。\`author set\` 以 preimage 摘要保护修改，保留 metadata history。普通 reader 不识别旧正文历史标记；一次性迁移保留原作者字节与审计provenance。

## E2E regression

\`command\`、\`repository\`、\`attested\` 是不同证据等级。Concord 通用 fixed 必须有自己签发的当前 red／green command 收据。Repository fixed 验证实际 formal receipt、inventory、certificate 和六条 reliability 收据后，在独占锁内绑定当前 Memory epoch。

Repository epoch 表示核验与绑定时的生命周期，不声称 runner 在该 epoch 签发；候选只表示 green 和 reliability 一致，不能据此证明当前工作区。reopen 增加 epoch，完整旧 resolution 入 history；已使用 invocation 不得被换路径复用。原条目声明已修只迁为 attested，始终未验证，不能满足新的 fixed gate。

## 命令与一致性

\`pnpm memory\`、\`pnpm feedback\` 和 \`pnpm exec concord\` 共用当前 schema。读、写、检查、迁移及恢复共享同一 publication lock；发现未完成 journal 时先按具名错误恢复。dry-run 不写用户文件或证据缓存，可以建立 Git-private 协调锁文件。

使用 \`--help\` 获取当前具名参数；运行 \`pnpm memory check\`、\`pnpm feedback check\` 与 \`pnpm exec concord check\` 检查结构和关系。检查成功不等于原生 E2E 测试涉及范围或历史修复在当前工作区仍有效。

## 迁移审计

本次收据位于 \`docs/migrations/concord-documents-20260914.json\`，条目每条原路径、目标路径、源 metadata 和正文摘要。它不是 runtime registry。历史 \`feedback/migration-receipt.json\` 与 \`feedback/schema-v2-migration-receipt.json\` 保持原 Git 时点语义，不改写为当前验证证明。
`;

const memoryLint = `import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { MemorySchema, decode } from "concord-sdlc/model";

const MEMORY_DIR = join(import.meta.dirname, "../..", "memory");
describe("memory owners", () => {
  it("every Memory uses the current strict schema", () => {
    const entries = readdirSync(MEMORY_DIR).filter(f => f.endsWith(".md") && f !== "INDEX.md");
    for (const entry of entries) {
      const source = readFileSync(join(MEMORY_DIR, entry), "utf8");
      const frontmatter = /^---\\r?\\n([\\s\\S]*?)\\r?\\n---(?:\\r?\\n|$)/u.exec(source);
      expect(frontmatter, entry).not.toBeNull();
      const yaml = parseDocument(frontmatter![1]!, { uniqueKeys: true, merge: false });
      expect(yaml.errors, entry).toEqual([]);
      const metadata = decode(MemorySchema, yaml.toJS({ maxAliasCount: 0 }) as unknown, entry);
      expect(metadata.id + ".md", entry).toBe(entry);
    }
  });
  it("the human index has no dangling file links", () => {
    const index = readFileSync(join(MEMORY_DIR, "INDEX.md"), "utf8");
    const files = new Set(readdirSync(MEMORY_DIR));
    const linked = [...index.matchAll(/\\]\\(([\\w-]+\\.md)\\)/g)].map(m => m[1]);
    expect(linked.filter(path => !files.has(path!))).toEqual([]);
  });
});
`;

export function prepareEntrypointMigration(root: string): readonly Change[] {
  const changes: Change[] = [];
  const change = (path: string, update: (before: string) => string): void => {
    const before = readFileSync(join(root, path), 'utf8');
    const after = update(before);
    if (after !== before) changes.push({ path, before, after });
  };
  change('docs/engineering/feedback-memory/README.md', () => feedbackMemoryGuide);
  change('lint/docs/memory-index.lint.ts', () => memoryLint);
  change('docs/source-map.md', before => before.replace('兼容转发入口', '锁定包导出入口').replace('Feedback v2、adoption、Memory relation 与 Issue source', '当前 Issue owner、adoption、Memory relation 与远端 source').replace('structured Memory、promotion、supersession', '当前 Memory、promotion、supersession'));
  change('docs/research/README.md', before => before.replace(/## 当前闭环[\s\S]*?(?=## 研究方向)/u, `## 当前闭环

独立研究页使用 \`concord.document/v1\` Research metadata，原路径就是身份。纯导航和收据仍为 supporting 页面，不重复计为研究 owner。\`pnpm exec concord research list\` 与页面从同一 metadata 发现条目；profile 入口见 \`pnpm run repo docs research --help\`。

\`observedAt\` 只保存原文明确观察日期，未声明时可省略。Git 首次登记时间由 \`createdAtSource\` 明示，不能充当研究日期。check 验证结构与归属，不联网、不证明引文或研究判断为真，也不代表研究已成为当前目标契约。

`));
  change('.agents/skills/memory/SKILL.md', before => before
    .replace('<problem|decision|insight>', '<problem|decision|insight|note>')
    .replace('Resolve with `pnpm memory resolve <id> --kind <kind> --proof <receipt>`, repeating `--proof` for each independent receipt.', 'Resolve with `pnpm memory resolve <id> --kind <kind> --reason <reason>`; the profile binds the current epoch and validates its managed formal evidence under the publication lease.')
    .replace('`--proof` text does not replace them.', 'Caller-supplied receipt or epoch metadata cannot replace that gate.')
    .replace('it changes only the current author region before the `Resolution history` marker, binds both the complete owner preimage and author-region preimage digests, never writes legacy Memory, and never removes managed history.', 'it changes the complete author body, binds owner and author preimage digests, and preserves the current frontmatter history.')
    .replace('Legacy unstructured Memory is searchable and referenceable but read-only.', 'Every Memory uses concord.document/v1. Captured records retain their classification without asserting a current lifecycle; activate a classified record explicitly with a reason. Notes remain captured. Superseded Problems are inapplicable records, not fixed Problems. Historical attested resolutions are unverified and never satisfy new fixed evidence gates.'));
  change('.agents/skills/feedback/SKILL.md', before => before
    .replace('Audit, migrate, or maintain existing NiceEval Feedback records and their legacy relations.', 'Maintain current Concord Issue owners, closure and Memory relations.')
    .replace('legacy Feedback and Memory design', 'Feedback and Memory design').replace('#legacy-feedback', '#feedback')
    .replace('Feedback is a retained Git owner for records that already exist.', 'Feedback is a local Issue owner at docs/issues/<id>.md using concord.document/v1.')
    .replace('list, show, export, check, migrate, or repair', 'list, show, export, check, or repair')
    .replace('when legacy investigation produces', 'when investigation produces')
    .replace('the changed Feedback directory', 'the changed docs/issues/<id>.md owner'));
  change('docs/engineering/docs-traceability/README.md', before => before
    .replace('结构化 regression 必须指向 Problem。legacy regression 显示为 `legacy/unstructured`，不能称为 Problem、Bug 或具有结构化终态，也不能满足 Problem-only gate。', 'Regression 必须指向当前 schema 的 Problem Memory。captured、superseded 或 attested 声明不能代替新的 fixed 执行证据。')
    .replace('legacy Memory 保持逐字节只读。', 'Memory 使用最新 metadata；迁移保留作者正文与历史 provenance。')
    .replace(/新 Feedback 统一用 worktree 内 `feedback\/\.stage-<token>`[^\n]+/u, '本地 Issue 统一写入 `docs/issues/<id>.md`，由共享 publication lease 与 journal 发布。普通操作不再创建旧 Feedback owner 目录。')
    .replace(/6\. 用独立 `niceeval\.feedback\/v1 → v2`[^\n]+/u, '6. Research、Memory 和 Issue 通过一次性迁移切换到 concord.document/v1；收据逐条保存原路径、目标路径、metadata 与正文摘要。旧 Feedback owner 移除，当前关系和历史保留。')
    .replace('470 条 legacy Memory 不转换、不改写，继续由既有兼容契约读取。', '551 条 Memory 全部转换到最新模型；没有常规旧格式 reader。明确历史事实保留，未知状态不伪造为当前裁决。')
    .replace('legacy Memory digest 在 move/adopt 前后不变', '迁移 Memory 作者正文摘要保持，metadata 变换有逐条审计'));
  change('docs/README.md', before => before.replace('- [Research](research/README.md)：带观察日期的外部产品研究。', '- [Research](research/README.md)：带观察日期的外部产品研究。\n- [Issue](issues/README.md)：保留用户观察原文及处理关系。') + '\nIssue 的观察原文属于调查事实，不是产品设计契约；保留报告者用语，不按设计文档的润色规则改写。其 metadata 由当前 Issue Schema 严格检查。\n');
  const issueIndex = 'docs/issues/README.md';
  const issueIndexBefore = existsSync(join(root, issueIndex)) ? readFileSync(join(root, issueIndex), 'utf8') : null;
  const issueIndexAfter = "# Issue\n\n本目录保存本地观察、处理状态和 Memory 关系。列表由 `concord.document/v1` metadata 派生，使用 `pnpm feedback list` 或 Concord 反馈页面查看。\n\n观察正文保留报告者的原文，不能当成产品目标契约。新远端条目见 [反馈与 Memory](../engineering/feedback-memory/README.md)。\n";
  if (issueIndexBefore !== issueIndexAfter) changes.push({ path: issueIndex, before: issueIndexBefore, after: issueIndexAfter });
  change('lint/docs/writing.ts', before => before
    .replace('import { join, resolve } from "node:path";', 'import { join, resolve } from "node:path";\nimport { parseDocument } from "yaml";\nimport { IssueSchema, decode } from "concord-sdlc/model";')
    .replace('      const sourceLines = readFileSync(join(ROOT, file), "utf8").split("\\n");', "      const source = readFileSync(join(ROOT, file), \"utf8\");\n      if (/^docs\\/issues\\/[^/]+\\.md$/u.test(file) && file !== \"docs/issues/README.md\") {\n        // Issue observations preserve the reporter's words; they are not design prose.\n        // Decode the current owner strictly instead of exempting arbitrary files by directory.\n        const frontmatter = /^---\\r?\\n([\\s\\S]*?)\\r?\\n---(?:\\r?\\n|$)/u.exec(source);\n        if (!frontmatter) throw new Error(`${file}: Issue frontmatter is required`);\n        const yaml = parseDocument(frontmatter[1]!, { uniqueKeys: true, merge: false });\n        if (yaml.errors.length > 0) throw new Error(`${file}: invalid Issue YAML`);\n        const issue = decode(IssueSchema, yaml.toJS({ maxAliasCount: 0 }) as unknown, file);\n        if (`docs/issues/${issue.id}.md` !== file) throw new Error(`${file}: Issue identity does not match its path`);\n        continue;\n      }\n      const sourceLines = source.split(\"\\n\");"));
  return changes;
}
