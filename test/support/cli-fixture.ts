import { createRequire } from 'node:module';
import { sourceCli } from './source-consumer.ts';
import { createConsumer } from './consumer.ts';
import { sourceRoot, prepareSourceConsumer } from './source-consumer.ts';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, cpSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from './temporary.ts';
import { join, resolve } from 'node:path';
import test, { after, before } from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { NodeServices } from '@effect/platform-node';
import { Effect, Schema } from 'effect';
import { chromium, expect, type Browser } from '@playwright/test';
import { pollUntil, readProjectConfig, writeProjectConfig, waitForWorkspaceProjection, fetchFresh } from './support.ts';
import { ProjectSchema, digest } from "../../src/model/index.ts";
import { caseDiscriminator, deriveTestReference } from "../../src/model/index.ts";
import { parseDocumentRecord } from "../../src/domain/documents/index.ts";
import { renderDocument } from "../../src/model/index.ts";
import { hawdb_native_HAWDB_REVISION as HAWDB_REVISION, openHawdb } from "../../src/base/cache/index.ts";
import { verifyInstalledNative } from '../../scripts/verify-installed-native.ts';
import { settleRefreshes } from '../../scripts/perf/process.ts';
export const Ack = Schema.Struct({});
export const ErrorOutput = Schema.Struct({ error: Schema.String });
export const DigestOutput = Schema.Struct({ digest: Schema.String });
export const PageOutput = Schema.Struct({ body: Schema.String, digest: Schema.String });
export const AnnotationOutput = Schema.Struct({ snippet: Schema.String });
export const CheckOutput = Schema.Struct({ ok: Schema.Boolean });
export const TraceOutput = Schema.Struct({ tests: Schema.Array(Schema.Struct({ id: Schema.String })) });
export const DoctorOutput = Schema.Struct({ cases: Schema.Int, missingTestRoots: Schema.Array(Schema.String) });
export const DryRunOutput = Schema.Struct({ dryRun: Schema.Boolean });
export const OwnerOutput = Schema.Struct({ document: Schema.Struct({ metadata: Schema.Unknown }) });
export const StateOutput = Schema.Struct({ document: Schema.Struct({ metadata: Schema.Struct({ state: Schema.String }) }) });
export const TemplatesOutput = Schema.Struct({ templates: Schema.Array(Schema.Struct({ name: Schema.String })) });
export const scratch=mkdtempSync(join(tmpdir(),'concord-installed-'));
export let cli: string;
before(() => Effect.runPromise(Effect.sync(() => {
 cli = sourceCli();
 const manifest = Schema.Struct({ version: Schema.String });
 const source = Schema.decodeUnknownSync(Schema.fromJsonString(manifest))(readFileSync(join(sourceRoot, 'package.json'), 'utf8'));
 assert.equal(execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim(), `concord v${source.version}`);
})));
after(() => Effect.runPromise(Effect.gen(function*() {
 yield* settleRefreshes(join(scratch, 'async-query')).pipe(Effect.provide(NodeServices.layer));
 yield* Effect.sync(() => rmSync(scratch, { recursive: true, force: true }));
})));

export function call<A>(root: string,args: readonly string[],schema: Schema.ConstraintDecoder<A, never>,input='Contract body.\n',status=0): A {
 const result=spawnSync(process.execPath,[cli,'--root',root,'--json','--fresh',...args],{input,encoding:'utf8',timeout:20000});
 assert.equal(result.status,status,JSON.stringify({args,signal:result.signal,stdout:result.stdout,stderr:result.stderr,error:result.error}));
 return Schema.decodeUnknownSync(Schema.fromJsonString(schema), { onExcessProperty: 'ignore', errors: 'all' })(status===0||result.stdout.trim()?result.stdout:result.stderr);
}
export function callString(root: string,args: readonly string[],input='Contract body.\n',status=0): string {
 return call(root, args, Schema.String, input, status);
}
export function readPage(root: string, path: string) { const body = readFileSync(join(root, path), 'utf8'); return { body, digest: digest(body) }; }
export function savePage(root: string, path: string, body: string, expectedDigest: string, status = 0) {
 return call(root, ['action', '--input', '-'], status === 0 ? Ack : ErrorOutput, JSON.stringify({ action: 'document.set', path, body, expectedDigest }), status) as { error?: string };
}
export function consumer(name: string){
 const root=join(scratch,name);cpSync(createConsumer(),root,{recursive:true});
 writeProjectConfig(root,{testRoots:['test','tests']});
 openHawdb(join(root,'.git/concord/cache.hawdb'),{readOnly:false,create:true}).close();
 return root;
}
export function write(root: string,path: string,source: string){mkdirSync(join(root,path,".."),{recursive:true});writeFileSync(join(root,path),source);}

export { createRequire };
export { sourceCli };
export { createConsumer };
export { sourceRoot };
export { prepareSourceConsumer };
export { assert };
export { execFileSync };
export { spawn };
export { spawnSync };
export { mkdtempSync };
export { mkdirSync };
export { writeFileSync };
export { rmSync };
export { readFileSync };
export { existsSync };
export { symlinkSync };
export { cpSync };
export { readdirSync };
export { renameSync };
export { tmpdir };
export { join };
export { resolve };
export { test };
export { after };
export { before };
export { once };
export { createServer };
export { pathToFileURL };
export { Effect };
export { Schema };
export { chromium };
export { expect };
export type { Browser };
export { pollUntil };
export { readProjectConfig };
export { writeProjectConfig };
export { waitForWorkspaceProjection };
export { fetchFresh };
export { ProjectSchema };
export { digest };
export { caseDiscriminator };
export { deriveTestReference };
export { parseDocumentRecord };
export { renderDocument };
export { HAWDB_REVISION };
export { openHawdb };
export { verifyInstalledNative };
export { settleRefreshes };
