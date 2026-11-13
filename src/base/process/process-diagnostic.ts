import { relative } from 'node:path';
import type { OwnedProcessResult } from './owned-process.ts';

const DIAGNOSTIC_OUTPUT_BYTES = 64 * 1024;
export function diagnosticOutputTail(output: string): string {
  const bytes = Buffer.from(output);
  let start = Math.max(0, bytes.length - DIAGNOSTIC_OUTPUT_BYTES);
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString('utf8');
}
export function processDiagnostic(result: OwnedProcessResult, root: string, cwd: string, step: string, op?: string) {
  return {
    step, ...(op === undefined ? {} : { op }), argv: result.command, cwd: relative(root, cwd) || '.',
    exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, cancelled: result.cancelled,
    ...(result.error === undefined ? {} : { error: result.error }),
    stdout: diagnosticOutputTail(result.stdout), stderr: diagnosticOutputTail(result.stderr),
    stdoutTruncated: result.outputLimitExceeded || Buffer.byteLength(result.stdout) > DIAGNOSTIC_OUTPUT_BYTES,
    stderrTruncated: result.outputLimitExceeded || Buffer.byteLength(result.stderr) > DIAGNOSTIC_OUTPUT_BYTES,
  };
}
export type ProcessDiagnostic = ReturnType<typeof processDiagnostic>;
