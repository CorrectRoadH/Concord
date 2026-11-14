// 跨进程保证：外部程序——候选归档汇总只读取字节，拒绝清单或动态库的自洽伪造。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { NodeServices } from '@effect/platform-node';
import { Effect } from 'effect';
import { collectRelease } from '../../scripts/assemble-release.ts';
import { compilationTarget } from '../../scripts/compile-application.ts';
import { archiveTarget, sha256 } from '../../scripts/archive-support.ts';
import { makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { hawdbLibraryName, hawdbTarget } from '../../src/base/installation/hawdb-native-contract.ts';
import { nativeArtifactRoot } from '../../src/base/installation/native-artifact.ts';
import { tmpdir } from '../support/temporary.ts';

// @feature docs/engineering/build/README.md
test('release collection verifies official manifest and final native members before accepting target candidates', () => Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const root = mkdtempSync(join(tmpdir(), 'concord-release-native-'));
  const target = archiveTarget(), nativeTarget = hawdbTarget(), version = '1.0.0', commit = '0'.repeat(40);
  const candidate = join(root, 'candidate'), content = join(root, 'content'), native = join(content, 'app/dist/native', nativeTarget);
  const filename = `concord-${version}-${target}.tar.gz`, archive = join(candidate, filename);
  const write = (path: string, value: unknown) => writeFileSync(join(content, path), JSON.stringify(value));
  try {
    mkdirSync(candidate); mkdirSync(join(content, 'app/dist'), { recursive: true });
    write('app/package.json', { version, gitHead: commit });
    write('app/dist/build-identity.json', { format: 'concord.build-source/v1', commit, dirty: false });
    write('app/dist/compiler.json', { version: readFileSync('.bun-version', 'utf8').trim(), revision: 'pinned-bun', binarySha256: '0'.repeat(64), target, cpu: compilationTarget(target) });
    cpSync(join(nativeArtifactRoot(makeRuntimeEnvironment(process.cwd(), process.env)), nativeTarget), native, { recursive: true });
    const pack = () => {
      execFileSync('tar', ['-czf', archive, '-C', content, 'app'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
      writeFileSync(join(candidate, 'SHA256SUMS'), `${sha256(readFileSync(archive))}  ${filename}\n`);
    };
    const collect = () => collectRelease(join(root, 'output'), [candidate]).pipe(Effect.exit);
    pack();
    let result = yield* collect();
    assert.match(String(result), /exactly one candidate for each/u, 'valid native bytes reach the cross-target completeness check');
    const binary = join(native, hawdbLibraryName(nativeTarget)), original = readFileSync(binary);
    writeFileSync(binary, 'untrusted library'); pack();
    result = yield* collect(); assert.match(String(result), /Candidate native member differs/u);
    writeFileSync(binary, original);
    writeFileSync(join(native, 'manifest.json'), '{}'); pack();
    result = yield* collect(); assert.match(String(result), /official native manifest differs/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
})).pipe(Effect.provide(NodeServices.layer))));
