import { readdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { Effect, Schema, SchemaIssue } from "effect";
import { parseDocument as parseYaml } from "yaml";

import {
  ResearchConflictError,
  ResearchFileError,
  ResearchFormatError,
  ResearchInputError,
  ResearchMigrationRequired,
  ResearchPathError,
  researchErrorMessage,
  type ResearchError,
} from "./errors.js";
import {
  RESEARCH_FORMAT,
  ResearchCommandInputSchema,
  ResearchFrontmatterSchema,
  type ResearchCheckFinding,
  type ResearchCheckReceipt,
  type ResearchCommandInput,
  type ResearchContent,
  type ResearchMutationReceipt,
  type ResearchOutcome,
} from "./model.js";
import {
  publishNewDirectory,
  publishNewFile,
  readResearchFile,
  readResearchFileIfPresent,
  sha256,
} from "./publication.js";
import { withTraceReadLease } from "../trace/relation-mutation.js";

const ROOT = "docs/research";
type Frontmatter = typeof ResearchFrontmatterSchema.Type;
type Inspection =
  | { readonly kind: "unmanaged" }
  | { readonly kind: "invalid"; readonly message: string }
  | { readonly kind: "document"; readonly frontmatter: Frontmatter };

function decodeUnknown<A>(
  path: string,
  schema: Schema.ConstraintDecoder<A, never>,
  input: unknown,
): Effect.Effect<A, ResearchInputError> {
  return Schema.decodeUnknownEffect(schema, {
    errors: "all",
    onExcessProperty: "error",
  })(input).pipe(
    Effect.mapError(error => new ResearchInputError({
      message: `${path}: ${SchemaIssue.makeFormatterDefault()(error.issue)}`,
    })),
  );
}

function refPath(reference: string): string {
  return reference.slice("research:".length);
}

function referenceFor(path: string): string {
  return `research:${path}`;
}

function isSafeRelativePath(path: string): boolean {
  if (
    path.length === 0 ||
    path.trim() !== path ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    path.includes("#")
  ) return false;
  return path.split("/").every(segment =>
    segment.length > 0 &&
    segment.trim() === segment &&
    segment !== "." &&
    segment !== ".." &&
    !/[\0\r\n]/u.test(segment)
  );
}

function markdown(title: string, body?: string): string {
  const suffix = body === undefined || body.length === 0
    ? ""
    : `\n\n${body.replace(/\s+$/u, "")}`;
  return `# ${title}${suffix}\n`;
}

function rootText(content: ResearchContent, path: string): string {
  const metadata = [
    `format: ${JSON.stringify(RESEARCH_FORMAT)}`,
    `id: ${JSON.stringify(`research-${sha256(path).slice(-12)}`)}`,
    `title: ${JSON.stringify(content.title)}`,
    `createdAt: ${JSON.stringify(new Date().toISOString())}`,
    "kind: research",
    ...(content.observedAt === undefined
      ? []
      : [`observedAt: ${JSON.stringify(content.observedAt)}`]),
    `sources: ${JSON.stringify(content.sources ?? [])}`,
  ];
  return `---\n${metadata.join("\n")}\n---\n\n${markdown(content.title, content.body)}`;
}

function parseDocument(
  path: string,
  source: string,
): Effect.Effect<Frontmatter, ResearchFormatError | ResearchInputError> {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (match === null) {
    return Effect.fail(new ResearchFormatError({
      path,
      message: "Missing Concord Research document frontmatter.",
    }));
  }
  return Effect.try({
    try: () => {
      const yaml = parseYaml(match[1]!, { uniqueKeys: true, merge: false });
      if (yaml.errors.length > 0) throw yaml.errors[0]!;
      return yaml.toJS({ maxAliasCount: 0 }) as unknown;
    },
    catch: cause => new ResearchFormatError({
      path,
      message: `Invalid Concord Research frontmatter: ${researchErrorMessage(cause)}`,
    }),
  }).pipe(Effect.flatMap(value => decodeUnknown(path, ResearchFrontmatterSchema, value)));
}

function inspect(path: string, source: string): Effect.Effect<Inspection> {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (match === null) return Effect.succeed({ kind: "unmanaged" });
  try {
    const yaml = parseYaml(match[1]!, { uniqueKeys: true, merge: false });
    if (yaml.errors.length > 0) throw yaml.errors[0]!;
    const value: unknown = yaml.toJS({ maxAliasCount: 0 });
    if (
      value === null ||
      typeof value !== "object" ||
      !("format" in value) ||
      value.format !== RESEARCH_FORMAT
    ) return Effect.succeed({ kind: "unmanaged" });
  } catch (cause) {
    return Effect.succeed({ kind: "invalid" as const, message: researchErrorMessage(cause) });
  }
  return parseDocument(path, source).pipe(
    Effect.map(frontmatter => ({ kind: "document", frontmatter }) as Inspection),
    Effect.catch(error => Effect.succeed({ kind: "invalid" as const, message: error.message })),
  );
}

function checkFile(path: string, source: string): Effect.Effect<ResearchCheckFinding[]> {
  return inspect(path, source).pipe(Effect.map(result => {
    if (result.kind === "unmanaged") return [{
      path,
      code: "unmanaged" as const,
      message: "This target is not a managed Concord Research document.",
    }];
    if (result.kind === "invalid") return [{
      path,
      code: "invalid-document" as const,
      message: result.message,
    }];
    if (!path.endsWith("/README.md")) return [{
      path,
      code: "research-migration-required" as const,
      message: `${path}: Research owners must use a topic directory with README.md; run the offline document package migration`,
    }];
    return [];
  }));
}

function receipt(
  command: ResearchMutationReceipt["command"],
  dryRun: boolean,
  target: string,
  digest: string,
): ResearchMutationReceipt {
  const action = command === "create-package"
    ? "create a package root"
    : "add a package-owned page";
  return {
    format: "niceeval.docs-research/receipt/v1",
    command,
    dryRun,
    ref: referenceFor(target),
    target,
    changedPaths: [target],
    preimage: { kind: "absent" },
    contentDigest: digest,
    summary: `${dryRun ? "Would " : ""}${action}: ${referenceFor(target)}.`,
  };
}

function isConcordFrontmatter(source: string): boolean {
  return /^---\r?\n(?:format:\s*["']?concord\.document\/|[\s\S]*?\r?\nformat:\s*["']?concord\.document\/)/u.test(source);
}

function ancestorDirectories(path: string): readonly string[] {
  const parts = path.split("/");
  const ancestors: string[] = [];
  for (let length = 1; length < parts.length; length += 1) {
    ancestors.push(parts.slice(0, length).join("/"));
  }
  return ancestors;
}

function validatePackageAncestors(root: string, packagePath: string): Effect.Effect<void, ResearchError> {
  return Effect.forEach(ancestorDirectories(`${ROOT}/${packagePath}`), directory => {
    const ownerPath = `${directory}/README.md`;
    return readResearchFileIfPresent(root, ownerPath).pipe(
      Effect.flatMap(source => {
        if (source === undefined || !isConcordFrontmatter(source)) return Effect.void;
        return parseDocument(ownerPath, source).pipe(
          Effect.catch(() => Effect.fail(new ResearchFormatError({
            path: ownerPath,
            message: "Ancestor Research owner metadata is invalid.",
          }))),
          Effect.flatMap(() => Effect.fail(new ResearchConflictError({
            path: ownerPath,
            message: "A package cannot be created below an existing Research owner.",
          }))),
        );
      }),
    );
  }, { discard: true });
}

function requirePackage(root: string, parent: string): Effect.Effect<string, ResearchError> {
  const target = refPath(parent);
  if (
    !target.endsWith("/README.md") ||
    !target.startsWith(`${ROOT}/`) ||
    !isSafeRelativePath(target)
  ) return Effect.fail(new ResearchInputError({
    message: "add-page requires an exact safe Research package-root ref ending in /README.md.",
  }));
  return readResearchFile(root, target).pipe(
    Effect.flatMap(source => parseDocument(target, source)),
    Effect.map(() => target),
  );
}

function nestedOwnerGuard(
  root: string,
  packageRoot: string,
  target: string,
): Effect.Effect<void, ResearchError> {
  const base = dirname(packageRoot);
  const parts = relative(base, dirname(target)).split(sep).filter(Boolean);
  return Effect.forEach(parts, (_part, index) => {
    const candidate = `${base}/${parts.slice(0, index + 1).join("/")}/README.md`;
    return readResearchFileIfPresent(root, candidate).pipe(
      Effect.flatMap(source => {
        if (source === undefined || !isConcordFrontmatter(source)) return Effect.void;
        return parseDocument(candidate, source).pipe(
          Effect.catch(() => Effect.fail(new ResearchFormatError({
            path: candidate,
            message: "Nested Research owner metadata is invalid.",
          }))),
          Effect.flatMap(() => Effect.fail(new ResearchConflictError({
            path: candidate,
            message: "Nested Research owner cannot be written by its parent package.",
          }))),
        );
      }),
    );
  }, { discard: true });
}

function createPackage(
  root: string,
  path: string,
  content: ResearchContent,
  dryRun: boolean,
): Effect.Effect<ResearchMutationReceipt, ResearchError> {
  if (!isSafeRelativePath(path)) return Effect.fail(new ResearchPathError({
    path,
    message: "Research package path must be a safe relative path.",
  }));
  const target = `${ROOT}/${path}`;
  const contentEffect = validatePackageAncestors(root, path).pipe(
    Effect.map(() => rootText(content, path)),
  );
  return publishNewDirectory(root, target, contentEffect, dryRun).pipe(
    Effect.map(({ digest }) => receipt("create-package", dryRun, `${target}/README.md`, digest)),
  );
}

function addPage(
  root: string,
  parent: string,
  page: string,
  content: ResearchContent,
  dryRun: boolean,
): Effect.Effect<ResearchMutationReceipt, ResearchError> {
  if (!isSafeRelativePath(page) || !page.endsWith(".md")) return Effect.fail(new ResearchPathError({
    path: page,
    message: "Supporting page must be a safe relative Markdown path ending in .md.",
  }));
  const parentPath = refPath(parent);
  const target = `${dirname(parentPath)}/${page}`;
  const contentEffect = requirePackage(root, parent).pipe(
    Effect.flatMap(packageRoot => nestedOwnerGuard(root, packageRoot, target)),
    Effect.map(() => markdown(content.title, content.body)),
  );
  return publishNewFile(root, target, contentEffect, dryRun).pipe(
    Effect.map(({ digest }) => receipt("add-page", dryRun, target, digest)),
  );
}

function walkMarkdown(directory: string, root: string): readonly string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new ResearchPathError({
      path: relative(root, absolute).split(sep).join("/"),
      message: "Research package discovery cannot traverse symbolic links.",
    });
    if (entry.isDirectory()) files.push(...walkMarkdown(absolute, root));
    else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(relative(root, absolute).split(sep).join("/"));
    }
  }
  return files.sort();
}

function under(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}/`);
}

function checkPackage(
  root: string,
  reference: string,
  target: string,
): Effect.Effect<ResearchCheckReceipt, ResearchError> {
  return Effect.gen(function*() {
    const rootSource = yield* readResearchFile(root, target);
    const findings = yield* checkFile(target, rootSource);
    const packageDirectory = dirname(target);
    const files = yield* Effect.try({
      try: () => walkMarkdown(dirname(resolve(root, target)), root),
      catch: cause => cause instanceof ResearchPathError
        ? cause
        : new ResearchFileError({
          operation: "enumerate package pages",
          path: target,
          message: researchErrorMessage(cause),
        }),
    });
    const ownerDirectories = new Map<string, "valid" | "invalid">();
    ownerDirectories.set(packageDirectory, "valid");
    const checkedPaths = [target];
    for (const path of files.filter(file => file.endsWith("/README.md") && file !== target)) {
      const source = yield* readResearchFile(root, path);
      if (!isConcordFrontmatter(source)) {
        checkedPaths.push(path);
        continue;
      }
      const inspection = yield* inspect(path, source);
      const directory = dirname(path);
      if (inspection.kind === "document") ownerDirectories.set(directory, "valid");
      else {
        ownerDirectories.set(directory, "invalid");
        findings.push({
          path,
          code: "invalid-document",
          message: inspection.kind === "invalid" ? inspection.message : "Invalid Research owner metadata.",
        });
      }
    }
    for (const path of files.filter(file => file !== target && !file.endsWith("/README.md"))) {
      const owners = [...ownerDirectories.entries()]
        .filter(([directory]) => under(path, directory))
        .sort(([left], [right]) => right.length - left.length);
      const owner = owners[0];
      if (owner === undefined || owner[0] !== packageDirectory) continue;
      const source = yield* readResearchFile(root, path);
      const inspection = yield* inspect(path, source);
      if (inspection.kind === "document") findings.push({
        path,
        code: "research-migration-required",
        message: `${path}: Research owners must use a topic directory with README.md; run the offline document package migration`,
      });
      else if (inspection.kind === "invalid") findings.push({ path, code: "invalid-document", message: inspection.message });
      checkedPaths.push(path);
    }
    return {
      format: "niceeval.docs-research/check/v1" as const,
      command: "check" as const,
      ok: findings.length === 0,
      ref: reference,
      target,
      checkedPaths,
      findings,
      summary: findings.length === 0
        ? `Concord Research check passed for ${reference}.`
        : `Concord Research check failed for ${reference} with ${findings.length} finding(s).`,
    };
  });
}

function checkResearch(root: string, reference: string): Effect.Effect<ResearchCheckReceipt, ResearchError> {
  const target = refPath(reference);
  if (!isSafeRelativePath(target) || !target.startsWith(`${ROOT}/`)) return Effect.fail(new ResearchPathError({
    path: target,
    message: "Research reference must be a safe repository-relative path.",
  }));
  if (target.endsWith("/README.md")) return checkPackage(root, reference, target);
  return readResearchFile(root, target).pipe(
    Effect.flatMap(source => checkFile(target, source)),
    Effect.map(findings => ({
      format: "niceeval.docs-research/check/v1" as const,
      command: "check" as const,
      ok: findings.length === 0,
      ref: reference,
      target,
      checkedPaths: [target],
      findings,
      summary: findings.length === 0
        ? `Concord Research check passed for ${reference}.`
        : `Concord Research check failed for ${reference} with ${findings.length} finding(s).`,
    })),
  );
}

function runDecoded(root: string, input: ResearchCommandInput): Effect.Effect<ResearchOutcome, ResearchError> {
  switch (input.command) {
    case "create-page":
      return Effect.fail(new ResearchMigrationRequired({
        message: "Standalone Research page creation is retired; run the offline document package migration.",
      }));
    case "create-package":
      return createPackage(root, input.path, input.content, input.dryRun);
    case "add-page":
      return addPage(root, input.parent, input.page, input.content, input.dryRun);
    case "check":
      return withTraceReadLease(root, () => checkResearch(root, input.ref));
  }
}

export function runResearchAt(root: string, input: unknown): Effect.Effect<ResearchOutcome, ResearchError> {
  return decodeUnknown("Research command input", ResearchCommandInputSchema, input).pipe(
    Effect.flatMap(decoded => runDecoded(root, decoded)),
  );
}

export function renderResearchOutcome(outcome: ResearchOutcome): string {
  if (outcome.command !== "check" || outcome.ok) return outcome.summary;
  return [outcome.summary, ...outcome.findings.map(finding => `- ${finding.path}: ${finding.message}`)].join("\n");
}

export function renderResearchError(error: ResearchError): string {
  switch (error._tag) {
    case "TraceRecoveryRequired": return `Unfinished journal at ${error.path}; run ${error.nextStep}.`;
    case "TraceRecoveryConflict": return `Recovery conflict at ${error.path}: ${error.message}`;
    case "TraceMutationError": return `Research publication ${error.phase}: ${error.message}`;
    case "ResearchInputError": return `Research input is invalid: ${error.message}`;
    case "ResearchMigrationRequired": return `ResearchMigrationRequired: ${error.message}`;
    case "ResearchPathError": return `Research path ${error.path} is invalid: ${error.message}`;
    case "ResearchConflictError": return `Research target ${error.path} conflicts: ${error.message}`;
    case "ResearchFileError": return `Research ${error.operation} failed for ${error.path}: ${error.message}`;
    case "ResearchFormatError": return `Concord Research format is invalid in ${error.path}: ${error.message}`;
  }
}
