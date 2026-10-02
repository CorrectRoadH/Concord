import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Effect, Schema } from 'effect';

const PackageArtifact = Schema.Struct({
  name: Schema.String, version: Schema.String, filename: Schema.String,
  files: Schema.Array(Schema.Struct({ path: Schema.String })),
});
export type PackedConcord = typeof PackageArtifact.Type;
const sourceRoot = fileURLToPath(new URL('..', import.meta.url));

// @use-case docs/feature/cross-platform-release/use-case/release-from-tag.md
export function packConcord(destination: string): PackedConcord {
  return Effect.runSync(Effect.sync(() => {
    const scratch = mkdtempSync(join(tmpdir(), 'concord-release-pack-'));
    try {
      const output = execFileSync('pnpm', ['--config.ignore-scripts=true', 'pack', '--skip-manifest-obfuscation', '--json', '--pack-destination', scratch], {
        cwd: sourceRoot, encoding: 'utf8', timeout: 60_000,
      });
      const artifact = Schema.decodeUnknownSync(Schema.fromJsonString(PackageArtifact))(output);
      execFileSync('tar', ['-xzf', resolve(scratch, artifact.filename), '-C', scratch]);
      // pnpm pack 强制排除自己的锁；补入唯一原始锁，不能另生成与开发依赖图不同的发布锁。
      const manifestSchema = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
      if (!isDeepStrictEqual(Schema.decodeUnknownSync(manifestSchema)(readFileSync(join(sourceRoot, 'package.json'), 'utf8')), Schema.decodeUnknownSync(manifestSchema)(readFileSync(join(scratch, 'package/package.json'), 'utf8')))) throw new Error('pnpm changed package metadata');
      // pnpm 会移除 manifest 末尾换行；语义相同后恢复源字节，保持跨渠道身份。
      for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) copyFileSync(join(sourceRoot, name), join(scratch, 'package', name));
      for (const name of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
        if (!readFileSync(join(sourceRoot, name)).equals(readFileSync(join(scratch, 'package', name)))) throw new Error(`Packed identity differs: ${name}`);
      }
      mkdirSync(destination, { recursive: true });
      const filename = resolve(destination, `${artifact.name}-${artifact.version}.tgz`);
      execFileSync('tar', ['-czf', filename, '-C', scratch, 'package']);
      const files = execFileSync('tar', ['-tzf', filename], { encoding: 'utf8' }).trim().split('\n')
        .filter(path => !path.endsWith('/')).map(path => ({ path: path.replace(/^package\//u, '') }));
      return { ...artifact, filename, files };
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  }));
}
