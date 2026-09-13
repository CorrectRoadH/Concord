// @concord-file human-command-output
// @concord-implements docs/feature/local-sdlc/README.md
import { Predicate } from 'effect';

const label = (key: string): string => key.replace(/([a-z])([A-Z])/gu, '$1 $2').replaceAll('-', ' ');
const scalar = (value: unknown): string => value === null ? 'none' : String(value);

/** Human output is a view; JSON continues to expose the original result. */
export function humanOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Predicate.isObject(value)) return scalar(value);
  if (Array.isArray(value)) return value.length ? value.map(item => humanOutput(item)).join('\n') : 'None.';
  if ('changedPaths' in value && Array.isArray(value.changedPaths)) {
    const lines = [`${value.dryRun ? 'Would apply' : 'Applied'} ${String(value.operation)}:`, ...value.changedPaths.map(path => `  ${String(path)}`)];
    if (value.recoveryRequired) lines.push('', 'Recovery required: run concord recover before another operation.');
    if (value.operation === 'init') lines.push('', 'Start here: docs/concord.md', 'Next: concord feature create <id> --title "Your feature"', 'Inspect configuration: concord doctor');
    else lines.push('', 'Next: edit the author prose, then run concord check.');
    return lines.join('\n');
  }
  if ((value.operation === 'test-annotate' || value.operation === 'code-annotate') && typeof value.snippet === 'string') return value.snippet;
  if (value.operation === 'template-show' && typeof value.body === 'string') return value.body;
  if (value.scope === 'command') return [
    `Command ${String(value.commandOutcome)} — ${String(value.selectedCaseId)}`,
    `Receipt: ${String(value.id)}`,
    'Scope: command (does not prove native case coverage)',
    `Execution: ${String(value.execution)}; exit: ${String(value.exitCode)}; cleanup: ${String(value.cleanupOk)}`,
    `Timeout: ${String(value.timedOut)}; cancelled: ${String(value.cancelled)}; signal: ${String(value.signal)}`,
    `Arguments: ${JSON.stringify(value.argv)}`,
    `Started: ${String(value.startedAt)}; finished: ${String(value.finishedAt)}`,
    'Use --json to inspect all recorded digests.',
  ].join('\n');
  const lines: string[] = [];
  if (typeof value.operation === 'string') lines.push(label(value.operation));
  for (const [key, item] of Object.entries(value)) {
    if (key === 'operation') continue;
    if (key === 'cache' && Predicate.isObject(item)) {
      lines.push(`Cache: ${String(item.status)}`);
    } else if (Array.isArray(item)) {
      lines.push(`${label(key)}: ${item.length === 0 ? 'none' : ''}`);
      for (const entry of item) {
        if (Predicate.isObject(entry) && typeof entry.path === 'string') {
          lines.push(`  ${entry.path}${entry.line ? `:${String(entry.line)}` : ''}${entry.title ? ` — ${String(entry.title)}` : ''}${entry.kind ? ` (${String(entry.kind)})` : ''}`);
          if (entry.state) lines.push(`    ${String(entry.memoryKind ?? entry.kind)}: ${String(entry.state)}`);
          if (entry.message) lines.push(`    ${String(entry.code ?? 'Finding')}: ${String(entry.message)}`);
          if (entry.evidence) lines.push(indent(humanOutput(entry.evidence), 4));
        } else if (Predicate.isObject(entry) && typeof entry.file === 'string' && Array.isArray(entry.contracts)) {
          lines.push(`  ${String(entry.id)} — ${entry.file}:${String(entry.line)}–${String(entry.endLine)} (${String(entry.scope)})`, ...entry.contracts.map(ref => `    Implements: ${String(ref)}`));
        } else if (Predicate.isObject(entry) && typeof entry.file === 'string') {
          lines.push(`  ${String(entry.id)} — ${entry.file}:${String(entry.line)}`, `    Contract: ${String(entry.contract)}`, `    Declaration: ${String(entry.status)}${entry.skipped ? ', skipped/todo' : ''}`);
          if (Array.isArray(entry.regressions)) for (const ref of entry.regressions) lines.push(`    Regression: ${String(ref)}`);
        } else lines.push(indent(humanOutput(entry), 2));
      }
    } else if (Predicate.isObject(item)) {
      lines.push(`${label(key)}:`, indent(humanOutput(item), 2));
    } else lines.push(`${label(key)}: ${scalar(item)}`);
  }
  if (value.operation === 'test-list' && Array.isArray(value.cases) && value.cases.length === 0) lines.push('Next: concord test annotate <id> --contract <Feature or Use Case path>', 'Place the output directly above a supported test declaration, then run concord check.');
  if (value.operation === 'code-list' && Array.isArray(value.codes) && value.codes.length === 0) lines.push('Next: configure sourceRoots in concord.json, then use concord --skill code.');
  if (value.operation === 'check' && value.cases === 0) lines.push('No test annotations found. This checks document integrity; it does not establish test coverage.');
  return lines.join('\n');
}

function indent(value: string, spaces: number): string {
  return value.split('\n').map(line => `${' '.repeat(spaces)}${line}`).join('\n');
}
