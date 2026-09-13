import ts from "typescript";
import { Result, Schema, SchemaIssue } from "effect";

import { CaseRelationsFormatError } from "./errors.js";
import {
  CaseIdSchema,
  CaseIssueSchema,
  CaseRelationSchema,
  CaseHistorySchema,
  CaseTombstoneSchema,
  type CaseHistory,
  type CaseIssue,
  type CaseRelation,
  type CaseTombstone,
} from "./sidecar.js";

const MANAGED = /^\s*\/\/\s*@concord-(case|owner|regression|issue|test-file)\s+(.+?)\s*$/u;
const HISTORY = /^\s*\/\/\s*@concord-(history|tombstone)\s+(.+?)\s*$/u;

export interface AnnotatedCase {
  readonly caseId: `necase_${string}`;
  readonly declarationPath: string;
  readonly testFile: string;
  readonly owner: string;
  readonly regressions: readonly string[];
  readonly issues: readonly CaseIssue[];
  readonly title: string;
  readonly declarationStart: number;
  readonly annotationStart: number;
  readonly annotationEnd: number;
  readonly annotationRanges: readonly { readonly start: number; readonly end: number }[];
}

export interface SupportedTestDeclaration { readonly title: string; readonly start: number }

export interface CaseArchive {
  readonly history: readonly { readonly testFile: string; readonly event: CaseHistory }[];
  readonly tombstones: readonly { readonly testFile: string; readonly event: CaseTombstone }[];
}

const decode = <A>(schema: Schema.Codec<A>, input: unknown, path: string, subject: string): A => {
  const decoded = Schema.decodeUnknownResult(schema, { errors: "all", onExcessProperty: "error" })(input);
  if (Result.isFailure(decoded)) throw new CaseRelationsFormatError({ path, message: `${subject}: ${SchemaIssue.makeFormatterDefault()(decoded.failure.issue)}` });
  return decoded.success;
};

const canonicalPath = (value: string, path: string, subject: string): string => {
  if (value.trim() !== value || value.length === 0 || value.startsWith("/") || value.includes("\\") || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new CaseRelationsFormatError({ path, message: `${subject} must be a canonical repository-relative path or reference` });
  }
  return value;
};

function runnerBindings(file: ts.SourceFile): Set<string> {
  const bindings = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !["vitest", "@playwright/test", "node:test"].includes(statement.moduleSpecifier.text)) continue;
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const element of named.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported === "test" || imported === "it") bindings.add(element.name.text);
    }
  }
  const shadowed = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (!ts.isImportDeclaration(node)) {
      if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isParameter(node)) && node.name !== undefined && ts.isIdentifier(node.name) && bindings.has(node.name.text)) shadowed.add(node.name.text);
      if (ts.isImportEqualsDeclaration(node) && bindings.has(node.name.text)) shadowed.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  for (const name of shadowed) bindings.delete(name);
  return bindings;
}

function testCall(node: ts.CallExpression, bindings: ReadonlySet<string>): { readonly title: string } | undefined {
  const expression = node.expression;
  const root = ts.isIdentifier(expression)
    ? expression.text
    : ts.isPropertyAccessExpression(expression) && expression.name.text === "concurrent" && ts.isIdentifier(expression.expression)
      ? expression.expression.text
      : ts.isCallExpression(expression)
          && ts.isPropertyAccessExpression(expression.expression)
          && expression.expression.name.text === "skipIf"
          && ts.isIdentifier(expression.expression.expression)
        ? expression.expression.expression.text
        : undefined;
  if (root === undefined || !bindings.has(root)) return undefined;
  const title = node.arguments[0];
  if (!title || !ts.isStringLiteralLike(title)) return undefined;
  return { title: title.text };
}

export function locateSupportedTestDeclarations(path: string, source: string): readonly SupportedTestDeclaration[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const bindings = runnerBindings(file);
  const declarations: SupportedTestDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const call = testCall(node, bindings);
      if (call !== undefined) declarations.push({ title: call.title, start: node.getStart(file) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return declarations;
}

function attachedLineComments(source: string, file: ts.SourceFile, node: ts.Node): readonly { readonly start: number; readonly end: number; readonly text: string }[] {
  const ranges = ts.getLeadingCommentRanges(source, node.getFullStart()) ?? [];
  const lines = ranges.filter((range) => range.kind === ts.SyntaxKind.SingleLineCommentTrivia).map((range) => ({ start: range.pos, end: range.end, text: source.slice(range.pos, range.end) }));
  if (lines.length === 0) return [];
  const last = lines.at(-1)!;
  if (!/^\s*$/u.test(source.slice(last.end, node.getStart(file)))) return [];
  let first = lines.length - 1;
  while (first > 0 && /^\s*$/u.test(source.slice(lines[first - 1]!.end, lines[first]!.start))) first -= 1;
  return lines.slice(first);
}

function managedLineRange(source: string, start: number, end: number, path: string): { readonly start: number; readonly end: number } {
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  if (!/^\s*$/u.test(source.slice(lineStart, start))) throw new CaseRelationsFormatError({ path, message: "managed annotation must occupy its own line" });
  const nextNewline = source.indexOf("\n", end);
  const lineEnd = nextNewline < 0 ? source.length : nextNewline + 1;
  if (!/^\s*(?:\r?\n)?$/u.test(source.slice(end, lineEnd))) throw new CaseRelationsFormatError({ path, message: "managed annotation must occupy its own line" });
  return { start: lineStart, end: lineEnd };
}

export function decodeAnnotatedCases(path: string, source: string): Result.Result<readonly AnnotatedCase[], CaseRelationsFormatError> {
  try {
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const bindings = runnerBindings(file);
    const cases: AnnotatedCase[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const call = testCall(node, bindings);
        if (call !== undefined) {
          const comments = attachedLineComments(source, file, node);
          const managed = comments.flatMap((comment) => {
            const match = MANAGED.exec(comment.text);
            return match === null ? [] : [{ ...comment, name: match[1]!, value: match[2]! }];
          });
          if (managed.length > 0) {
            const byName = (name: string) => managed.filter((entry) => entry.name === name);
            const ids = byName("case"); const owners = byName("owner"); const testFiles = byName("test-file");
            if (ids.length !== 1 || owners.length !== 1 || testFiles.length > 1) throw new CaseRelationsFormatError({ path, message: `managed annotations above test declaration at ${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1} require exactly one case and owner, and at most one test-file` });
            const caseId = decode(CaseIdSchema, ids[0]!.value, path, "case ID") as `necase_${string}`;
            const owner = canonicalPath(owners[0]!.value, path, "owner");
            if (!owner.includes("#")) throw new CaseRelationsFormatError({ path, message: `owner for ${caseId} must include an exact anchor` });
            const regressions = byName("regression").map((entry) => canonicalPath(entry.value, path, "regression"));
            if (new Set(regressions).size !== regressions.length) throw new CaseRelationsFormatError({ path, message: `regressions for ${caseId} contain duplicates` });
            const issues = byName("issue").map((entry) => {
              let input: unknown;
              try { input = JSON.parse(entry.value) as unknown; } catch (cause) { throw new CaseRelationsFormatError({ path, message: `issue for ${caseId} is not strict JSON: ${String(cause)}` }); }
              return decode(CaseIssueSchema, input, path, `issue for ${caseId}`);
            });
            if (new Set(issues.map((issue) => issue.url)).size !== issues.length) throw new CaseRelationsFormatError({ path, message: `issues for ${caseId} contain duplicate URLs` });
            const testFile = testFiles.length === 0 ? path : canonicalPath(testFiles[0]!.value, path, "test-file");
            if (!call.title.endsWith(` [${caseId}]`)) throw new CaseRelationsFormatError({ path, message: `annotated declaration for ${caseId} does not end its literal runner title with the same ID` });
            const start = Math.min(...managed.map((entry) => entry.start));
            const end = Math.max(...managed.map((entry) => entry.end));
            const annotationRanges = managed.map(({ start, end }) => managedLineRange(source, start, end, path));
            cases.push({ caseId, declarationPath: path, testFile, owner, regressions, issues, title: call.title, declarationStart: node.getStart(file), annotationStart: start, annotationEnd: end, annotationRanges });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    const managedCommentStarts = new Set<number>();
    const collectComments = (node: ts.Node): void => {
      const ranges = [
        ...(ts.getLeadingCommentRanges(source, node.getFullStart()) ?? []),
        ...(ts.getTrailingCommentRanges(source, node.getEnd()) ?? []),
      ];
      for (const range of ranges) {
        if (range.kind === ts.SyntaxKind.SingleLineCommentTrivia && MANAGED.test(source.slice(range.pos, range.end))) managedCommentStarts.add(range.pos);
      }
      ts.forEachChild(node, collectComments);
    };
    collectComments(file);
    const managedCommentCount = managedCommentStarts.size;
    const boundCommentCount = cases.reduce((sum, item) => sum + item.annotationRanges.length, 0);
    if (managedCommentCount !== boundCommentCount) {
      throw new CaseRelationsFormatError({ path, message: `found a dangling, ambiguous, duplicated, or pseudo managed annotation that is not bound to one supported literal test/it declaration (managed=${managedCommentCount}, bound=${boundCommentCount})` });
    }
    return Result.succeed(cases.sort((a, b) => a.declarationStart - b.declarationStart));
  } catch (cause) {
    return Result.fail(cause instanceof CaseRelationsFormatError ? cause : new CaseRelationsFormatError({ path, message: cause instanceof Error ? cause.message : String(cause) }));
  }
}

export function renderCaseAnnotations(caseId: string, relation: CaseRelation, declarationPath: string, testFile: string): string {
  const lines = [
    `// @concord-case ${caseId}`,
    `// @concord-owner ${relation.owner}`,
    ...relation.regressions.map((memory) => `// @concord-regression ${memory}`),
    ...relation.issues.map((issue) => `// @concord-issue ${JSON.stringify(issue)}`),
    `// @concord-test-file ${testFile}`,
  ];
  return lines.join("\n");
}

export function replaceCaseAnnotations(source: string, item: AnnotatedCase, relation: CaseRelation, testFile = item.testFile): string {
  let output = source;
  const [first, ...rest] = item.annotationRanges;
  if (first === undefined) return source;
  for (const range of [...rest].sort((a, b) => b.start - a.start)) output = output.slice(0, range.start) + output.slice(range.end);
  const ending = /\r\n$/u.test(source.slice(first.start, first.end)) ? "\r\n" : /\n$/u.test(source.slice(first.start, first.end)) ? "\n" : "";
  return output.slice(0, first.start) + renderCaseAnnotations(item.caseId, relation, item.declarationPath, testFile) + ending + output.slice(first.end);
}

export function stripManagedCaseAnnotations(path: string, source: string): Result.Result<string, CaseRelationsFormatError> {
  const decoded = decodeAnnotatedCases(path, source);
  if (Result.isFailure(decoded)) return Result.fail(decoded.failure);
  let projected = source;
  const ranges = decoded.success.flatMap((item) => item.annotationRanges).sort((a, b) => b.start - a.start);
  for (const range of ranges) projected = projected.slice(0, range.start) + projected.slice(range.end);
  return Result.succeed(projected);
}

const ArchivedHistorySchema = Schema.Struct({ testFile: Schema.String, event: CaseHistorySchema });
const ArchivedTombstoneSchema = Schema.Struct({ testFile: Schema.String, event: CaseTombstoneSchema });

export function decodeCaseArchive(path: string, source: string): Result.Result<CaseArchive, CaseRelationsFormatError> {
  try {
    const history: { testFile: string; event: CaseHistory }[] = [];
    const tombstones: { testFile: string; event: CaseTombstone }[] = [];
    for (const [index, line] of source.split("\n").entries()) {
      if (line.trim() === "" || /^\s*\/\//u.test(line) && !line.includes("@concord-")) continue;
      const match = HISTORY.exec(line);
      if (match === null) throw new CaseRelationsFormatError({ path, message: `line ${index + 1} must contain only a concord history or tombstone comment` });
      let input: unknown;
      try { input = JSON.parse(match[2]!) as unknown; } catch (cause) { throw new CaseRelationsFormatError({ path, message: `line ${index + 1} contains invalid JSON: ${String(cause)}` }); }
      if (match[1] === "history") history.push(decode(ArchivedHistorySchema, input, path, `history line ${index + 1}`));
      else tombstones.push(decode(ArchivedTombstoneSchema, input, path, `tombstone line ${index + 1}`));
    }
    return Result.succeed({ history, tombstones });
  } catch (cause) {
    return Result.fail(cause instanceof CaseRelationsFormatError ? cause : new CaseRelationsFormatError({ path, message: String(cause) }));
  }
}

export function encodeCaseArchive(archive: CaseArchive): string {
  return [
    "// Concord repository case history. This file is not a test entry.",
    ...archive.history.map((entry) => `// @concord-history ${JSON.stringify(entry)}`),
    ...archive.tombstones.map((entry) => `// @concord-tombstone ${JSON.stringify(entry)}`),
    "",
  ].join("\n");
}
