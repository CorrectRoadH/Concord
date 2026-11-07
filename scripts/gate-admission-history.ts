// @concord-file
// @concord-implements docs/engineering/testing/cli.md#并发
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Effect, FileSystem, Schema } from 'effect';
import { gateMemoryBudgets, GiB } from './gate-resources.ts';
import { externalBuildOutput } from './build-output.ts';

export class GateAdmissionHistoryInvalid extends Schema.TaggedError<GateAdmissionHistoryInvalid>()('GateAdmissionHistoryInvalid', {
  file: Schema.String, message: Schema.String,
}) {}
const PeakBytes = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER));
export const GateAdmissionPeak = Schema.Struct({ format: Schema.Literal('concord.gate-admission/v1'), file: Schema.String, peakBytes: PeakBytes });
export const gateAdmissionHistoryRoot = () => join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'concord', 'gate-admission');
export const gateAdmissionHistoryPath = (file: string, cacheRoot = gateAdmissionHistoryRoot()) => join(cacheRoot, `${createHash('sha256').update(resolve(file)).digest('hex')}.json`);
export const gateNodeReservation = (peakBytes?: number) => peakBytes === undefined ? gateMemoryBudgets.node : Math.max(GiB / 2, Math.ceil(peakBytes / (GiB / 2)) * (GiB / 2));

export const readGateNodeReservation = Effect.fn('gate.history.read')(function*(file: string, cacheRoot = gateAdmissionHistoryRoot()) {
  const fs = yield* FileSystem.FileSystem;
  cacheRoot = yield* externalBuildOutput(cacheRoot);
  const path = gateAdmissionHistoryPath(file, cacheRoot);
  if (!(yield* fs.exists(path))) return gateNodeReservation();
  const record = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(GateAdmissionPeak), { onExcessProperty: 'error' })(yield* fs.readFileString(path));
  if (record.file !== resolve(file)) return yield* new GateAdmissionHistoryInvalid({ file, message: `Cache path identity mismatch: ${path}` });
  return gateNodeReservation(record.peakBytes);
}, Effect.mapError(cause => cause instanceof GateAdmissionHistoryInvalid ? cause : new GateAdmissionHistoryInvalid({ file: 'admission history', message: String(cause) })));

export const writeGateNodePeak = Effect.fn('gate.history.write')(function*(file: string, peakBytes: number, cacheRoot = gateAdmissionHistoryRoot()) {
  const fs = yield* FileSystem.FileSystem;
  cacheRoot = yield* externalBuildOutput(cacheRoot);
  const record = yield* Schema.decodeUnknownEffect(GateAdmissionPeak, { onExcessProperty: 'error' })({ format: 'concord.gate-admission/v1', file: resolve(file), peakBytes });
  yield* fs.makeDirectory(cacheRoot, { recursive: true });
  const path = gateAdmissionHistoryPath(file, cacheRoot), temporary = `${path}.${randomUUID()}.tmp`;
  yield* Effect.acquireUseRelease(Effect.succeed(temporary), temporary => fs.writeFileString(temporary, `${JSON.stringify(record)}\n`).pipe(Effect.andThen(fs.rename(temporary, path))), temporary => fs.remove(temporary, { force: true }).pipe(Effect.orDie));
}, Effect.mapError(cause => new GateAdmissionHistoryInvalid({ file: 'admission history', message: String(cause) })));
