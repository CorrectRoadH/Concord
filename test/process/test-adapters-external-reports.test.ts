// 跨进程保证：外部程序——真实adapter报告的跳过、解析失败、链接、额外文件及超预算使执行结果无效。
import { RuntimeEnvironment, makeRuntimeEnvironment } from '../../src/base/environment/index.ts';
import { sourceCli, assert, existsSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, join, tmpdir, fileURLToPath, test, Effect, Schema, OwnedProcessLive, hasSuccessfulOwnedProcessResult, runOwnedProcess, ProjectSchema, renderTypeScriptConfig, parseTypeScriptConfig, type TestAdapter, LocalRepository, closeRepositoryCache, withPersistentCache, prepareSourceConsumer, sourceRoot, text, scratch, command, requireCommand, parse, CaseList, Receipt, setup, prepare, configure, call, success, idFor, environment, builtin } from '../support/test-adapters-consumer-fixture.ts';


import { externalCase } from '../support/external-adapter-fixture.ts';

// @use-case docs/feature/local-sdlc/use-case/run-native-test-adapters.md
// @name external-adapter-boundaries-reports
test("external adapter validates every report and protocol rejection scenario (C3-C5 C12-C16) (report integrity)", { skip: process.platform !== 'linux' && 'Native report directory-handle traversal is not verified on this platform' }, () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
  const { consumer, cli, id } = yield* externalCase();
  for (const mode of ['skip', 'parser-failed', 'symlink', 'unexpected-report', 'large-report']) {
    yield* Effect.sync(() => text(consumer, 'mode.txt', mode));
    const run = yield* call(consumer, cli, ['test', 'run', id, '--require-native']);
    const receipt = Schema.decodeUnknownSync(Receipt)(JSON.parse(run.stdout));
    assert.equal(receipt.commandOutcome, ['green', 'split'].includes(mode) ? 'green' : 'invalid', `${mode}: ${run.stderr}\n${run.stdout}`);
    assert.equal(receipt.requested?.length, 2);
    if (mode === 'split') assert.equal(receipt.commandExecutionCount, 2);
  }
})).pipe(Effect.provide(OwnedProcessLive), Effect.provideService(RuntimeEnvironment, makeRuntimeEnvironment(process.cwd(), process.env)))));
