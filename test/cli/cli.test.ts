import { createRequire, packageBin, createConsumer, packConcord, installConcord, assert, execFileSync, spawn, spawnSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, cpSync, readdirSync, renameSync, tmpdir, join, resolve, test, after, before, once, createServer, pathToFileURL, Effect, Schema, chromium, expect, type Browser, authorDesignFixture, pollUntil, readProjectConfig, writeProjectConfig, waitForWorkspaceProjection, fetchFresh, ProjectSchema, digest, caseDiscriminator, deriveTestReference, parseDocumentRecord, renderDocument, HAWDB_REVISION, openHawdb, verifyInstalledNative, settleRefreshes, Ack, ErrorOutput, DigestOutput, PageOutput, AnnotationOutput, CheckOutput, TraceOutput, DoctorOutput, DryRunOutput, OwnerOutput, StateOutput, DecisionOutput, MemoryLifecycleOutput, TemplatesOutput, scratch, cli, call, callString, clearDecision, readPage, savePage, consumer, write } from '../support/cli-fixture.js';


// @use-case docs/feature/local-data-engine/use-case/query-current-projections.md
test('installed HawDB caches and current recall work through an installation symlink without Rust or a database helper', () =>
  Effect.runPromise(Effect.gen(function*() {
    const installation = yield* Effect.sync(() => {
      const directory = mkdtempSync(join(scratch, 'private-native-'));
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true }));
      installConcord(directory, packConcord(scratch), [], { private: true });
      return directory;
    });
    const alias = join(scratch, 'opt-concord');
    yield* Effect.sync(() => symlinkSync(join(installation, 'node_modules/concord-sdlc'), alias));
    yield* verifyInstalledNative(alias);
  })));


// @use-case docs/feature/local-sdlc/use-case/recall-and-maintain-memory.md
test('memory note stays captured and decision activation writes only current fields', () => {
 const root = consumer('memory-note-activation');
 call(root, ['new', 'memory', 'triage-note', '--title', 'Triage note', '--type', 'note'], Ack);
 assert.equal(call(root, ['show', 'memory/triage-note.md'], MemoryLifecycleOutput).document.metadata.status, 'captured');
 assert.equal(call(root, ['memory', 'activate', 'triage-note', '--reason', 'Classify'], ErrorOutput, '', 1).error, 'InvalidMemoryState');
 call(root, ['new', 'memory', 'choice', '--title', 'Choice', '--type', 'decision'], Ack);
 call(root, ['memory', 'activate', 'choice', '--reason', 'Adopt'], Ack);
 assert.equal(call(root, ['show', 'memory/choice.md'], MemoryLifecycleOutput).document.metadata.status, 'current');
 assert.doesNotMatch(readFileSync(join(root, 'memory/choice.md'), 'utf8'), /epoch:|history:|createdAt:/);
});
