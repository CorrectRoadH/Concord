import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, Schema } from 'effect';

export { packConcord } from '../scripts/release-package.js';
import type { PackedConcord } from '../scripts/release-package.js';
const sourceRoot = fileURLToPath(new URL('..', import.meta.url));

export function installConcord(directory: string, artifact: PackedConcord, dependencies: readonly string[] = []): void {
  Effect.runSync(Effect.sync(() => {
    const manifestPath = join(directory, 'package.json');
    const manifest = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))(readFileSync(manifestPath, 'utf8'));
    const { packageManager } = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ packageManager: Schema.String })))(readFileSync(join(sourceRoot, 'package.json'), 'utf8'));
    // 仓库外的临时消费者也必须选择本项目固定的 pnpm，不能落到机器默认版本。
    writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, packageManager }, null, 2)}\n`);
    // 真实消费者只访问自己声明的依赖，不靠提升 Concord 的传递依赖取得编译器或 runner。
    execFileSync('pnpm', ['add', '--ignore-workspace', '--ignore-scripts', '--prefer-offline', '--save-exact', artifact.filename, ...dependencies], {
      cwd: directory, encoding: 'utf8', timeout: 120_000,
    });
  }));
}
