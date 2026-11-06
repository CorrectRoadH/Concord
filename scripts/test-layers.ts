// @concord-file
// @concord-implements docs/engineering/testing/README.md#分层
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { summarizeFileTimings, type FileTiming } from './gate-timings.ts';

export const testLayers = ['model', 'domain', 'cli', 'process', 'e2e'] as const;
export type TestLayer = typeof testLayers[number];
export interface TestFileTiming { readonly file: string; readonly duration_ms: number; readonly cases?: number }
export interface TestLayerReport {
  readonly layer: TestLayer;
  readonly files: number;
  readonly timedFiles: number;
  readonly cases: number;
  readonly countedFiles: number;
  /** Observed Node file elapsed or browser attempt sum; concurrent work may overlap. */
  readonly duration_ms: number;
}

/** Root-level tests are pure architecture checks; nested directories own their boundary. */
export function classifyTestLayer(file: string, root = process.cwd()): TestLayer | undefined {
  const path = (isAbsolute(file) ? relative(root, file) : file).split(sep).join('/');
  if (!/^test\/(?:[^/]+\/)*[^/]+\.(?:test|e2e)\.ts$/u.test(path)) return undefined;
  const parts = path.split('/');
  if (parts.length === 2) return path.endsWith('.test.ts') ? 'model' : undefined;
  return testLayers.find(layer => parts[1] === layer);
}

export function summarizeTestLayers(files: readonly string[], timings: readonly TestFileTiming[] = [], root = process.cwd()): TestLayerReport[] {
  const reports = new Map<TestLayer, { layer: TestLayer; files: number; timedFiles: number; cases: number; countedFiles: number; duration_ms: number }>(
    testLayers.map(layer => [layer, { layer, files: 0, timedFiles: 0, cases: 0, countedFiles: 0, duration_ms: 0 }]),
  );
  const selected = new Map<string, TestLayer>();
  for (const file of files) {
    const layer = classifyTestLayer(file, root);
    const key = resolve(root, file);
    if (layer === undefined || selected.has(key)) continue;
    selected.set(key, layer);
    reports.get(layer)!.files++;
  }
  // Last timing wins, just as the official file wrapper owns a case with the same title.
  const measured = new Map(timings.map(timing => [resolve(root, timing.file), timing]));
  for (const [file, timing] of measured) {
    const layer = selected.get(file);
    if (layer === undefined) continue;
    const report = reports.get(layer)!;
    report.timedFiles++;
    report.duration_ms += timing.duration_ms;
    if (timing.cases !== undefined) { report.countedFiles++; report.cases += timing.cases; }
  }
  return [...reports.values()];
}

/** Report the complete discovered inventory independently of execution selection. */
export function auditTestLayers(files: readonly string[], root = process.cwd()): TestLayerReport[] {
  return summarizeTestLayers(files, [], root);
}

/** Keep legacy numeric observations while labeling their owner and completeness. */
export function summarizeMeasuredTestLayers(files: readonly string[], timings: readonly FileTiming[], root = process.cwd()) {
  return summarizeTestLayers(files, timings, root).map(row => {
    const measurement = summarizeFileTimings(files.filter(file => classifyTestLayer(file, root) === row.layer), timings,
      row.layer === 'e2e' ? 'browser-attempt-sum' : 'node-file-elapsed-sum', true, root);
    return { ...row, metric: measurement.metric, state: measurement.state, complete_duration_ms: measurement.duration_ms };
  });
}
