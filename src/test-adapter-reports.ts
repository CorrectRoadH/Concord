// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/run-native-test-adapters.md
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, readlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ConcordError, digest } from './shared.js';
import type { TestAdapter } from './test-adapter-config.js';

export function reportPath(path: string): string {
  if (path.includes('\\') || path.includes('\0') || path.startsWith('/') || path.split('/').some(part => part === '' || part === '.' || part === '..')) throw new ConcordError('ReportUnsafe', `Report path must stay inside its allocated invocation directory: ${path}`);
  return path;
}
export interface ReportBudget { files: number; bytes: number }
export function readReports(directory: string, declared: readonly string[], adapter: TestAdapter, budget: ReportBudget): readonly { path: string; digest: string; text: string }[] {
  if (new Set(declared).size !== declared.length) throw new ConcordError('ReportUnsafe', 'Repeated report paths');
  declared.forEach(reportPath);
  const records: { path: string; digest: string; text: string }[] = [];
  if (process.platform !== 'linux') throw new ConcordError('ReportUnsafe', 'Safe directory-handle report traversal is unavailable on this platform');
  const walk = (path: string, prefix: string): void => {
    const descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const before = fstatSync(descriptor);
      if (!before.isDirectory()) throw new ConcordError('ReportUnsafe', 'Report parent is not a directory');
      const handle = `/proc/self/fd/${descriptor}`;
      if (readlinkSync(handle) !== resolve(directory, prefix)) throw new ConcordError('ReportUnsafe', 'Report directory resolved through a replaced or symbolic-link ancestor');
      for (const name of readdirSync(handle).sort()) {
        const relative = prefix ? `${prefix}/${name}` : name;
        const target = join(handle, name); const stat = lstatSync(target);
        if (stat.isSymbolicLink()) throw new ConcordError('ReportUnsafe', 'Symbolic links are forbidden in reports');
        if (stat.isDirectory()) {
          if (relative.split('/').length > 64 || !declared.some(report => report.startsWith(`${relative}/`))) throw new ConcordError('ReportUnsafe', 'Unexpected or excessively nested report directory');
          walk(target, relative); continue;
        }
        if (!stat.isFile() || stat.nlink !== 1 || !declared.includes(relative)) throw new ConcordError('ReportUnsafe', `Unexpected or non-regular report: ${relative}`);
        budget.files++; budget.bytes += stat.size;
        if (budget.files > (adapter.budgets?.reportFiles ?? 64) || stat.size > (adapter.budgets?.reportFileBytes ?? 8 * 1024 * 1024) || budget.bytes > (adapter.budgets?.reportBytes ?? 32 * 1024 * 1024)) throw new ConcordError('ReportUnsafe', 'Reports exceed their file or byte budget');
        const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const opened = fstatSync(fd);
          if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.nlink !== 1 || !opened.isFile()) throw new ConcordError('ReportUnsafe', 'Report identity changed before reading');
          const buffer = Buffer.alloc(stat.size + 1);
          // readFileSync(fd) would be unbounded if a producer kept extending the file.
          const { bytesRead } = readBounded(fd, buffer);
          const after = fstatSync(fd); const linked = lstatSync(target);
          if (bytesRead !== stat.size || after.size !== stat.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || linked.ino !== stat.ino || linked.dev !== stat.dev || linked.nlink !== 1) throw new ConcordError('ReportUnsafe', 'Report changed during reading');
          const bytes = buffer.subarray(0, bytesRead); const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          if (/<!\s*(?:DOCTYPE|ENTITY)/iu.test(text)) throw new ConcordError('ReportUnsafe', 'DTD and XML entities are forbidden');
          records.push({ path: relative, digest: digest(bytes), text });
        } finally { closeSync(fd); }
      }
      const after = lstatSync(path);
      if (after.dev !== before.dev || after.ino !== before.ino || after.isSymbolicLink()) throw new ConcordError('ReportUnsafe', 'Report directory identity changed');
    } finally { closeSync(descriptor); }
  };
  try { walk(directory, ''); }
  catch (cause) { if (cause instanceof ConcordError) throw cause; throw new ConcordError('ReportUnsafe', `Cannot safely read invocation reports: ${String(cause)}`); }
  if (records.length !== declared.length) throw new ConcordError('ReportUnsafe', 'A declared report is missing from this invocation');
  return records;
}
function readBounded(fd: number, buffer: Buffer): { bytesRead: number } {
  let bytesRead = 0;
  while (bytesRead < buffer.length) { const count = readSync(fd, buffer, bytesRead, buffer.length - bytesRead, null); if (count === 0) break; bytesRead += count; }
  return { bytesRead };
}
