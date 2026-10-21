// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/use-editor-service.md
import { pathToFileURL } from 'node:url';
import { lstatSync } from 'node:fs';
import { Effect } from 'effect';
import { LocalRepository } from './storage.js';
import { readPublicationRevisionSync } from './coordination.js';
import { scanAnnotations } from './annotations.js';
import { diagnoseDocuments } from './documents.js';
import { codeReferenceTokens, scanCode } from './code.js';
import { checkWriting } from './writing.js';
import { extractSteps, markdownAnchor } from './steps.js';
import { parseReference, resolveReference } from './refs.js';
import { excludedSourcePath } from './source-discovery.js';
import { ConcordError, digest, failure, type Finding, type Repository } from './shared.js';
import { editorLimits, positionOffset, type Computed, type Job } from './editor-protocol.js';

const range = (line: number, character = 0, end = character) => ({ start: { line: Math.max(0, line - 1), character }, end: { line: Math.max(0, line - 1), character: end } });
const referenceTokens: (path: string, text: string, languageServers?: Repository['config']['languageServers']) => ReturnType<typeof codeReferenceTokens> = codeReferenceTokens;

/** One disposable thread owns domain parser caches and exactly one optimistic source snapshot. */
export const computeEditor = Effect.fn('editor.compute')(function*(job: Job) {
  return yield* Effect.acquireUseRelease(
    Effect.try({ try: () => new LocalRepository(job.root, { access: 'read', optimistic: true }), catch: failure }),
    local => Effect.try({ try: (): Computed => local.snapshot(() => {
      const revision = readPublicationRevisionSync(local.root);
      if (local.configSnapshot.digest !== job.config || revision !== job.revision) throw new ConcordError('ContentModified', 'Configuration or publication changed before computation');
      const reads = new Map<string, readonly [string | null, string | null]>();
      const listings = new Map<string, Computed['listings'][number]>();
      const overlays = new Map(job.overlays.map(document => [document.path, document]));
      const gaps = new Set<string>();
      let bytes = 0;
      const disk = (path: string): string | undefined => {
        local.absolute(path);
        const text = local.read(path);
        if (!reads.has(path)) {
          bytes += text === undefined ? 0 : Buffer.byteLength(text);
          if (bytes > editorLimits.input || reads.size >= editorLimits.files) throw new ConcordError('EditorBudgetExceeded', 'Source input limit');
          const stat = text === undefined ? undefined : lstatSync(local.absolute(path), { bigint: true });
          reads.set(path, [text === undefined ? null : digest(text), stat === undefined ? null : `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`]);
        }
        return text;
      };
      disk('concord.config.ts');
      const repo: Repository = {
        root: local.root, privateDir: local.privateDir, access: 'read', config: local.config, configSnapshot: local.configSnapshot,
        absolute: path => local.absolute(path),
        read: path => {
          const source = disk(path);
          const opened = overlays.get(path);
          if (opened === undefined) return source;
          if (!opened.valid) throw new ConcordError('InvalidDocumentState', `${path} requires close and reopen`);
          if (path === 'concord.config.ts' && opened.text !== source) throw new ConcordError('EditorConfigurationOverlayUnsupported', 'Configuration authorization requires saved configuration');
          if (opened.existed && source === undefined) gaps.add('MissingDiskDependency');
          return opened.text;
        },
        files: (prefix, scope) => {
          local.absolute(prefix);
          const paths = local.files(prefix, scope);
          if (paths.length > editorLimits.files) throw new ConcordError('EditorBudgetExceeded', 'File membership limit');
          listings.set(JSON.stringify([prefix, scope]), { prefix, source: scope === 'source', paths });
          const result = new Set(paths);
          for (const document of job.overlays) {
            local.absolute(document.path);
            if (document.path !== prefix && !document.path.startsWith(`${prefix}/`)) continue;
            if (document.path.split('/').some(part => part === '.git' || part === 'node_modules')) continue;
            if (scope === 'source' && excludedSourcePath(document.path, prefix, local.config.sourceIgnore ?? [])) continue;
            result.add(document.path);
          }
          return [...result].sort();
        },
        publish: () => { throw new ConcordError('ReadOnlyEditor', 'The editor cannot publish'); },
      };
      for (const document of job.overlays) repo.read(document.path);
      const inventory = diagnoseDocuments(repo);
      const annotations = scanAnnotations(repo, { cache: 'off', sourceMode: 'overlay' });
      const code = scanCode(repo, { cache: 'off' });
      const trace = { documents: inventory.documents, annotations, codeDeclarations: code.codes };
      const findings: Finding[] = [...inventory.findings, ...annotations.findings, ...code.findings];
      if (!inventory.complete || code.relationsUnknown) gaps.add('IncompleteRelations');
      for (const path of repo.files('docs').filter(path => path.endsWith('.md'))) {
        const text = repo.read(path);
        if (text !== undefined) findings.push(...extractSteps(path, text).findings);
      }
      const checkReference = (path: string, line: number, reference: string, kinds: Parameters<typeof resolveReference>[3]) => {
        try { return resolveReference(repo, inventory.documents, reference, kinds); }
        catch (cause) {
          const error = failure(cause);
          if (error.code === 'ReferenceNotFound') gaps.add('MissingReferenceDependency');
          const parsed = parseReference(reference);
          const target = inventory.documents.find(document => document.path === parsed.path);
          const text = repo.read(parsed.path);
          const stepMissing = gaps.size === 0 && error.code === 'AnchorNotFound' && target?.metadata.kind === 'use-case' && text !== undefined && extractSteps(parsed.path, text).findings.length === 0;
          findings.push({ code: stepMissing ? 'StepNotFound' : error.code, path, line, message: error.message });
          return undefined;
        }
      };
      for (const item of annotations.cases) {
        const owner = checkReference(item.file, item.line, item.contract, ['feature', 'use-case']);
        if (owner !== undefined && owner.metadata.kind !== item.contractKind) findings.push({ code: 'ContractKindMismatch', path: item.file, line: item.line, message: `@${item.contractKind} must reference that contract kind` });
        for (const target of item.regressions) checkReference(item.file, item.line, target, ['memory']);
      }
      for (const item of code.codes) for (const target of item.contracts) checkReference(item.file, item.line, target, ['feature', 'use-case', 'engineering']);
      try {
        const writing = checkWriting(repo);
        findings.push(...writing.findings.map(item => ({ code: item.rule, path: item.file, line: item.line, message: item.message })));
      } catch (cause) {
        const error = failure(cause); gaps.add(error.code);
        findings.push({ code: error.code, path: '.', message: error.message });
      }
      const uri = (path: string) => pathToFileURL(local.absolute(path)).href;
      const source = job.params === undefined ? undefined : repo.read(job.overlays.find(document => document.uri === job.params!.textDocument.uri)?.path ?? (() => { throw new ConcordError('DocumentNotOpen', 'Navigation requires an open document'); })());
      let selected: string | undefined;
      if (job.params !== undefined && source !== undefined) {
        const offset = positionOffset(source, job.params.position, 'utf-16');
        const path = job.overlays.find(document => document.uri === job.params!.textDocument.uri)!.path;
        const step = extractSteps(path, source).steps.find(step => job.params!.position.line + 1 >= step.line && job.params!.position.line + 1 <= step.endLine);
        selected = step === undefined ? undefined : `${path}#${step.id}`;
        for (const match of source.matchAll(/docs\/[^\s<>"'`()[\]{};,]+\.md(?:#[^\s<>"'`()[\]{};,]+)?/gu)) {
          if (offset >= match.index && offset <= match.index + match[0].length) { selected = match[0]; break; }
        }
        if (selected === undefined && path.endsWith('.md')) {
          const anchor = markdownAnchor(source.split('\n')[job.params.position.line] ?? '');
          if (anchor !== undefined) selected = `${path}#${anchor}`;
        }
        if (selected === undefined && path.endsWith('.md')) selected = path;
      }
      const locate = (reference: string) => {
        resolveReference(repo, trace.documents, reference);
        const parsed = parseReference(reference), text = repo.read(parsed.path)!;
        const steps = extractSteps(parsed.path, text);
        const step = steps.steps.find(step => step.id === parsed.anchor);
        const line = parsed.anchor === undefined ? 1 : step?.line ?? text.split('\n').findIndex(line => markdownAnchor(line) === parsed.anchor || line.includes(`<a id="${parsed.anchor}"></a>`)) + 1;
        return { uri: uri(parsed.path), range: range(Math.max(1, line)), text, parsed, step };
      };
      let value: unknown = null;
      if (job.method === 'textDocument/completion') {
        const candidates = new Set<string>();
        for (const path of repo.files('docs').filter(path => path.endsWith('.md'))) {
          try { resolveReference(repo, trace.documents, path, ['feature', 'use-case', 'engineering']); }
          catch { continue; }
          candidates.add(path);
          const text = repo.read(path)!;
          for (const step of extractSteps(path, text).steps) candidates.add(`${path}#${step.id}`);
        }
        value = { isIncomplete: gaps.size > 0, items: [...candidates].sort().slice(0, 2000).map(label => ({ label, kind: 18, insertText: label, detail: 'Concord canonical reference' })) };
        if (candidates.size > 2000) value = { ...value as object, isIncomplete: true };
      } else if (selected !== undefined) {
        try {
          const target = locate(selected);
          if (job.method === 'textDocument/definition') value = [{ uri: target.uri, range: target.range }];
          else if (job.method === 'textDocument/hover') {
            const content = target.step === undefined ? target.text : target.text.split('\n').slice(target.step.line - 1, target.step.endLine).join('\n');
            value = { contents: { kind: 'markdown', value: `**${selected}**\n\n${content.slice(0, 32000)}\n\nConcord source relations only. Analysis observations are not provided; this does not establish absence of relationships or execution coverage.\n\nInput complete: ${gaps.size === 0}.${gaps.size ? ` Gaps: ${[...gaps].join(', ')}.` : ''}` } };
          } else if (job.method === 'textDocument/references') {
            const locations: { uri: string; range: ReturnType<typeof range> }[] = [];
            for (const item of trace.annotations.cases) if (item.status === 'active' && item.contract === selected) locations.push({ uri: uri(item.file), range: range(item.line) });
            const implementations = trace.codeDeclarations.filter(item => item.contracts.includes(selected));
            for (const file of new Set(implementations.map(item => item.file))) {
              const tokens = referenceTokens(file, repo.read(file)!, repo.config.languageServers).filter(token => token.reference === selected);
              // A clean scanner result authorizes its exact lexical markers, including
              // node/region comments outside the declaration's executable range.
              if (tokens.length > 0 && !code.findings.some(finding => finding.path === file)) {
                for (const token of tokens) locations.push({ uri: uri(file), range: range(token.line) });
              } else for (const item of implementations.filter(item => item.file === file)) locations.push({ uri: uri(file), range: range(item.line) });
            }
            if (job.params?.context !== undefined && typeof job.params.context === 'object' && job.params.context !== null && 'includeDeclaration' in job.params.context && job.params.context.includeDeclaration === true) locations.push({ uri: target.uri, range: target.range });
            value = [...new Map(locations.map(location => [JSON.stringify(location), location])).values()];
          }
        } catch (cause) {
          if (!(cause instanceof ConcordError) || !['ReferenceNotFound', 'AnchorNotFound', 'InvalidReference', 'InvalidReferenceTarget'].includes(cause.code)) throw cause;
          value = job.method === 'textDocument/references' || job.method === 'textDocument/definition' ? [] : null;
        }
      } else if (job.method === 'textDocument/references' || job.method === 'textDocument/definition') value = [];
      const diagnostics = job.overlays.map(document => ({ uri: document.uri, version: document.version, diagnostics: [
        ...findings.filter(finding => finding.path === document.path).map(finding => ({ range: range(finding.line ?? 1), severity: 1, code: finding.code === 'StepNotFound' && gaps.size > 0 ? 'AnchorNotFound' : finding.code, source: 'concord' as const, message: finding.message })),
        ...([...gaps].length ? [{ range: range(1), severity: 2, code: 'EditorInputsIncomplete', source: 'concord' as const, message: `Input incomplete: ${[...gaps].join(', ')}. No complete-project conclusion is available.` }] : []),
      ] }));
      return { generation: job.generation, revision, config: local.configSnapshot.digest, complete: gaps.size === 0, gaps: [...gaps], value, diagnostics, reads: [...reads].map(([path, values]) => [path, ...values] as const), listings: [...listings.values()] };
    }), catch: failure }),
    local => Effect.sync(() => local.close()),
  );
});
