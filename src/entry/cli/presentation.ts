// @concord-file
// @concord-implements docs/feature/local-sdlc/cli.md#通用约定
// @concord-implements docs/feature/project-onboarding/use-case/start-writing-specs.md#guide
import { Predicate } from "effect";

const label = (key: string): string => key.replaceAll('-', ' ');
const scalar = (value: unknown): string => value === null ? 'none' : String(value);

function bodySnippet(body: string, firstTerm: string): string {
  const text = body.replace(/\s+/gu, ' ').trim();
  if (!text) return '(empty body)';
  const index = text.toLocaleLowerCase().indexOf(firstTerm.toLocaleLowerCase());
  const start = index < 0 ? 0 : Math.max(0, index - 40);
  const end = Math.min(text.length, index < 0 ? 100 : Math.max(index + firstTerm.length, index + 100));
  return `${index < 0 ? '[first term matched title] ' : ''}${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

function matchingSnippet(body: string, terms: readonly string[]): string {
  const lowered = body.toLocaleLowerCase();
  return bodySnippet(body, terms.find(term => lowered.includes(term.toLocaleLowerCase())) ?? terms[0] ?? '');
}

/** Human output is a view; JSON continues to expose the original result. */
export function humanOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Predicate.isObject(value)) return scalar(value);
  if (Array.isArray(value)) return value.length ? value.map(item => humanOutput(item)).join('\n') : 'None.';
  if (value.error && Predicate.isObject(value.details) && Predicate.isObject(value.details.process)) {
    const process = value.details.process;
    return [
      `ok: false`, `error: ${String(value.error)}`, `message: ${String(value.message)}`, 'process:',
      ...(typeof process.commit === 'string' ? [`  commit: ${process.commit}`] : []),
      `  step: ${String(process.step)}${process.op ? ` (${String(process.op)})` : ''}`,
      `  argv: ${JSON.stringify(process.argv)}`, `  cwd: ${String(process.cwd)}`,
      `  exit: ${scalar(process.exitCode)}`, `  signal: ${scalar(process.signal)}`,
      `  timedOut: ${String(process.timedOut)}`, `  cancelled: ${String(process.cancelled)}`,
      ...(typeof process.error === 'string' ? [`  error: ${process.error}`] : []),
      ...(['stdout', 'stderr'] as const).flatMap(channel => {
        const output = String(process[channel] ?? '');
        return [`  ${channel} (last ${Buffer.byteLength(output)} bytes${process[`${channel}Truncated`] ? ', truncated' : ''}):`, indent(output, 4)];
      }),
    ].join('\n');
  }
  // @concord-begin
  // @concord-implements docs/feature/project-onboarding/use-case/open-uninitialized-repo.md#cli
  if (value.error === 'ProjectNotInitialized' && Predicate.isObject(value.details)) return `ok: false\nerror: ProjectNotInitialized\nmessage: ${String(value.message)}\n\nInitialize: concord init\nWriting guide after init: concord --skill start`;
  // @concord-end
  if (value.operation === 'herdr-install') return `${value.dryRun ? 'Would install' : value.updated ? 'Updated' : 'Installed'} Concord mod: ${String(value.path)}\n${value.openHerdr ? 'Open Herdr, then open the "Concord" command.' : 'Herdr loads it on save; open it with the "Concord" command.'}`;
  if (value.operation === 'herdr-uninstall') return value.absent ? 'Concord mod is not installed' : `${value.dryRun ? 'Would uninstall' : 'Uninstalled'} Concord mod: ${String(value.path)}`;
  if (Predicate.isObject(value.document) && Array.isArray(value.pages)) {
    const { pages, ...relations } = value;
    return ['Pages:', ...pages.filter(Predicate.isObject).map(page => `  ${String(page.path)} [${String(page.kind)}] ${String(page.name)}`), '', humanOutput(relations)].join('\n');
  }
  if (Predicate.isObject(value.projection)) {
    const { projection, ...result } = value;
    return `Diagnostic snapshot: ${String(projection.builtAt)} (historical; refresh ${String(projection.refresh)})\n${projection.lastError ? `Last refresh failed: ${JSON.stringify(projection.lastError)}\n` : ''}${humanOutput(result.operation === 'cached-query' ? result.body : result)}`;
  }
  if (value.operation === 'taste' && Array.isArray(value.entries) && Array.isArray(value.references)) {
    const references = value.references.filter(Predicate.isObject);
    return value.entries.filter(Predicate.isObject).flatMap(entry => {
      const hits = references.filter(ref => ref.entry === entry.id || typeof ref.entry === 'string' && ref.entry.startsWith(`${String(entry.id)}-`));
      return [`${entry.id === 'general' ? '' : `${String(entry.id).toUpperCase()} `}${String(entry.title)}`, ...(hits.length ? hits.map(ref => `  ${String(ref.path)}:${String(ref.line)}`) : ['  (没有页面依据这一条)'])];
    }).join('\n');
  }
  if (typeof value.conclusion === 'string') return `${value.dryRun ? 'Would close Issue\n' : ''}${value.conclusion}`;
  if (value.operation === 'docs-check' && Array.isArray(value.findings)) {
    return [
      `Documentation writing: ${value.ok ? 'passed' : 'failed'} (${String(value.files)} files)`,
      `Mode: ${String(value.mode)}; selection: ${Array.isArray(value.selectedRoots) ? value.selectedRoots.join(', ') : ''}`,
      `Policy: ${String(value.policy)}`,
      ...value.findings.filter(Predicate.isObject).map(hit => `${String(hit.file)}:${String(hit.line)} [${String(hit.rule)}] ${String(hit.message)}`),
    ].join('\n');
  }
  if (value.operation === 'init-cancelled') return 'Initialization cancelled. No files or private state were written.';
  if (value.operation === 'skills-install') {
    const lines: string[] = [];
    for (const [heading, paths] of [['Created', value.createdPaths], ['Updated', value.updatedPaths], ['Removed', value.removedPaths], ['Unchanged', value.unchangedPaths]] as const) {
      if (Array.isArray(paths) && paths.length) lines.push(`${heading}:`, ...paths.map(path => `  ${String(path)}`));
    }
    if (value.recoveryRequired) lines.push('', 'Recovery required: run concord recover before another operation.');
    lines.push('', 'Next: commit these files so everyone on the project gets the commands.');
    return lines.join('\n');
  }
  if (value.operation === 'init-preview' && Predicate.isObject(value.configuration)) {
    const configuration = value.configuration;
    const lines = ['Initialization preview', '', 'Configuration overrides:', `  ${JSON.stringify(configuration, null, 2).replaceAll('\n', '\n  ')}`];
    lines.push('', 'Create:');
    for (const path of Array.isArray(value.create) ? value.create : []) lines.push(`  ${String(path)}`);
    lines.push('', 'Preserve:');
    if (!Array.isArray(value.preserve) || value.preserve.length === 0) lines.push('  none');
    else for (const path of value.preserve) lines.push(`  ${String(path)}`);
    return lines.join('\n');
  }
  if (value.operation === 'view') return [
    'Concord view', `Root: ${String(value.root)}`, `Host: ${String(value.host)}  Port: ${String(value.port)}`, '',
    ...(Array.isArray(value.local) ? value.local.map(address => `  Local:   ${String(address)}`) : []),
    ...(Array.isArray(value.network) ? value.network.map(address => `  Network: ${String(address)}`) : []),
  ].join('\n');
  if (value.operation === 'recover') {
    const coordination = Predicate.isObject(value.coordination) ? value.coordination : {};
    const publication = Predicate.isObject(coordination.publication) ? coordination.publication : {};
    const runner = Predicate.isObject(coordination.runner) ? coordination.runner : {};
    return [`Recovery: ${String(value.status)}`, `Journal: ${String(value.journalStatus ?? value.status)}`,
      `Publication tokens reclaimed: ${Array.isArray(publication.reclaimedTokens) ? publication.reclaimedTokens.length : 0}`,
      `Runner: ${String(runner.status ?? 'unknown')}`, ...(typeof runner.message === 'string' ? [runner.message] : []),
      ...(Array.isArray(value.changedPaths) ? value.changedPaths.map(path => `  ${String(path)}`) : [])].join('\n');
  }
  if ((value.operation === 'memory-search' || value.operation === 'issue-search') && typeof value.query === 'string') {
    const entries = value.documents;
    if (!Array.isArray(entries) || entries.length === 0) return `${label(value.operation)}\nNone.`;
    const terms = value.query.trim().split(/\s+/u);
    return [label(value.operation), ...entries.filter(Predicate.isObject).flatMap(entry => [
      `${String(entry.path)} — ${String(entry.title ?? (Predicate.isObject(entry.metadata) ? entry.metadata.title : ''))}`,
      `  ${matchingSnippet(typeof entry.body === 'string' ? entry.body : '', terms)}`,
    ])].join('\n');
  }
  if ('changedPaths' in value && Array.isArray(value.changedPaths)) {
    if (value.operation === 'move' && Array.isArray(value.moves) && Array.isArray(value.unmanagedReferences)) return [
      `${value.dryRun ? 'Would apply' : 'Applied'} move:`, ...value.moves.filter(Predicate.isObject).map(move => `  ${String(move.from)} → ${String(move.to)}`), '',
      'Changed:', ...value.changedPaths.map(path => `  ${String(path)}`),
      ...(value.unmanagedReferences.length ? ['', 'Not rewritten:', ...value.unmanagedReferences.filter(Predicate.isObject).map(reference => `  ${String(reference.path)}:${String(reference.line)}`)] : []),
    ].join('\n');
    const verified = Predicate.isObject(value.verification) ? [`Verified fix — ${String(value.changedPaths[0])}`, `Defect: ${String(value.verification.defect)}`, `Fix: ${String(value.verification.fix)}`, `Tests: ${Array.isArray(value.verification.tests) ? value.verification.tests.join(', ') : ''}`] : [];
    const lines = [...verified, `${value.dryRun ? 'Would apply' : 'Applied'} ${String(value.operation)}:`, ...value.changedPaths.map(path => `  ${String(path)}`)];
    if ((value.operation === 'feedback-sync' || value.operation === 'feedback-import') && typeof value.fetched === 'number' && typeof value.imported === 'number') {
      lines.push('', `Fetched: ${String(value.fetched)}; imported: ${String(value.imported)}.`);
    }
    if (Array.isArray(value.warnings) && value.warnings.length > 0) lines.push('', 'Warnings:', ...value.warnings.map(warning => `  ${String(warning)}`));
    if (value.recoveryRequired) lines.push('', 'Recovery required: run concord recover before another operation.');
    if (value.operation === 'init') lines.push('', 'Start here: docs/concord.md', 'Writing guide: concord --skill start', 'Inspect configuration: concord doctor');
    else if (!value.dryRun && value.changedPaths.length > 0) lines.push('', value.operation === 'new' ? 'Next: edit the pages, then run concord check.' : typeof value.operation === 'string' && value.operation.startsWith('create-') ? 'Next: edit the author prose, then run concord check.' : 'Next: concord check.');
    return lines.join('\n');
  }
  if ((value.operation === 'test-marker' || value.operation === 'code-marker') && typeof value.snippet === 'string') return value.snippet;
  if (value.operation === 'template-show' && typeof value.body === 'string') return value.body;
  if (value.scope === 'command') return [
    `Command ${String(value.commandOutcome)} — ${String(value.selectedCaseId)}`,
    'Scope: command (does not prove native case coverage)',
    `Execution: ${String(value.execution)}; exit: ${String(value.exitCode)}; cleanup: ${String(value.cleanupOk)}`,
    `Timeout: ${String(value.timedOut)}; cancelled: ${String(value.cancelled)}; signal: ${String(value.signal)}`,
    `Arguments: ${JSON.stringify(value.arguments)}`,
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
          const metadata = Predicate.isObject(entry.metadata) ? entry.metadata : entry;
          lines.push(`  ${entry.path}${entry.line ? `:${String(entry.line)}` : ''}${metadata.title ? ` — ${String(metadata.title)}` : ''}${metadata.kind ? ` (${String(metadata.kind)})` : ''}`);
          if (entry.status) lines.push(`    ${String(entry.type ?? entry.kind ?? (value.operation === 'issue-index' ? 'issue' : 'memory'))}: ${String(entry.status)}`);
          if (entry.message) lines.push(`    ${String(entry.code ?? 'Finding')}: ${String(entry.message)}`);
          if (entry.evidence) lines.push(indent(humanOutput(entry.evidence), 4));
          if (Array.isArray(entry.steps)) lines.push(indent(humanOutput({ steps: entry.steps, wholeUseCase: entry.wholeUseCase, nonStepAnchors: entry.nonStepAnchors, unassociatedSteps: entry.unassociatedSteps, observation: entry.observation }), 4));
          if (Array.isArray(entry.lists)) lines.push(indent(humanOutput({ lists: entry.lists }), 4));
        } else if (Predicate.isObject(entry) && typeof entry.file === 'string' && Array.isArray(entry.contracts)) {
          lines.push(`  ${String(entry.id)} — ${entry.file}:${String(entry.line)}–${String(entry.endLine)} (${String(entry.scope)})`, ...entry.contracts.map(ref => `    Implements: ${String(ref)}`));
        } else if (Predicate.isObject(entry) && typeof entry.file === 'string' && typeof entry.id === 'string' && typeof entry.line === 'number' && typeof entry.contract === 'string') {
          lines.push(`  ${String(entry.id)} — ${entry.file}:${String(entry.line)}`, `    Contract: ${String(entry.contract)}`, `    Declaration: ${String(entry.status)}${entry.skipped ? ', skipped/todo' : ''}`);
          if (Array.isArray(entry.issues)) for (const ref of entry.issues) lines.push(`    Issue: ${String(ref)}`);
        } else lines.push(indent(humanOutput(entry), 2));
      }
    } else if (Predicate.isObject(item)) {
      lines.push(`${label(key)}:`, indent(humanOutput(item), 2));
    } else lines.push(`${label(key)}: ${scalar(item)}`);
  }
  if (value.operation === 'test-list' && Array.isArray(value.cases) && value.cases.length === 0) lines.push('Next: concord test marker --contract <Feature or Use Case path>', 'Place the marker in a test file, then run concord check.');
  if (value.operation === 'code-list' && Array.isArray(value.codes) && value.codes.length === 0) lines.push('Next: configure sourceRoots in concord.config.ts, then use concord --skill code.');
  if (value.operation === 'check' && value.cases === 0) lines.push('No test annotations found. This checks document integrity; it does not establish test coverage.');
  return lines.join('\n');
}

function indent(value: string, spaces: number): string {
  return value.split('\n').map(line => `${' '.repeat(spaces)}${line}`).join('\n');
}
