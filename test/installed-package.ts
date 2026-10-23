import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, Schema } from 'effect';

import { PackageArtifact, packConcord as packRelease } from '../scripts/release-package.js';
import type { PackedConcord } from '../scripts/release-package.js';
const sourceRoot = fileURLToPath(new URL('..', import.meta.url));

/** The run owns the archive; each test still owns its copy and isolated install. */
export function packConcord(destination: string): PackedConcord {
  const manifest = process.env.CONCORD_TEST_ARTIFACT;
  if (manifest === undefined) return packRelease(destination);
  return Effect.runSync(Effect.sync(() => {
    const artifact = Schema.decodeUnknownSync(Schema.fromJsonString(PackageArtifact), { onExcessProperty: 'error' })(readFileSync(manifest, 'utf8'));
    mkdirSync(destination, { recursive: true });
    const filename = join(destination, `${artifact.name}-${artifact.version}.tgz`);
    copyFileSync(artifact.filename, filename);
    return { ...artifact, filename };
  }));
}

export function installConcord(directory: string, artifact: PackedConcord, dependencies: readonly string[] = []): void {
  Effect.runSync(Effect.sync(() => {
    const manifestPath = join(directory, 'package.json');
    const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(readFileSync(manifestPath, 'utf8'));
    const { packageManager } = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ packageManager: Schema.String })))(readFileSync(join(sourceRoot, 'package.json'), 'utf8'));
    // 仓库外的临时消费者也必须选择本项目固定的 pnpm，不能落到机器默认版本。
    writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, packageManager }, null, 2)}\n`);
    // 独立消费者必须采用同一预发布 Effect 版本约束，否则上游范围会解析到不匹配的稳定版。
    copyFileSync(join(sourceRoot, 'pnpm-workspace.yaml'), join(directory, 'pnpm-workspace.yaml'));
    // 真实消费者只访问自己声明的依赖，不靠提升 Concord 的传递依赖取得编译器或 runner。
    // Some cases deliberately damage installed files. Never hard-link them to
    // the shared pnpm store or to another consumer of the same run artifact.
    execFileSync('pnpm', ['add', '--workspace-root', '--ignore-scripts', '--prefer-offline', '--package-import-method=copy', '--save-exact', artifact.filename, ...dependencies], {
      cwd: directory, encoding: 'utf8', timeout: 120_000,
    });
  }));
}
