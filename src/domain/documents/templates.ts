// @concord-file
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md#随包模板
import { Installation, type TemplateResources } from "../../base/installation/index.js";
import { Effect, Schema } from "effect";
import { ConcordError, failure } from "../../model/index.js";
import { TEMPLATE_PAGES, PAGE_DESCRIPTIONS, type TemplatePage } from "../../model/index.js";


const TEMPLATE_NAMES = [
  'feature', 'roadmap', 'design', 'engineering', 'use-case', 'memory', 'issue',
  'library', 'cli', 'architecture', 'use-case-index',
  'project-index', 'concepts', 'project-architecture', 'taste', 'project-design',
] as const;

const TemplateNameSchema = Schema.Literals(TEMPLATE_NAMES);
const RelativeTemplatePath = Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u));
const ManifestSchema = Schema.Struct({
  format: Schema.Literal('concord.templates/v1'),
  templates: Schema.Array(Schema.Struct({
    name: TemplateNameSchema,
    description: Schema.String.check(Schema.isMinLength(1)),
    path: RelativeTemplatePath,
  })),
});

type Manifest = typeof ManifestSchema.Type;
type ManifestEntry = Manifest['templates'][number];


function templateFailure(code: string, message: string, cause?: unknown): ConcordError {
  return new ConcordError(code, message, cause);
}

function readManifest(resources: TemplateResources): Manifest {
  let source: string;
  try {
    source = resources.manifest;
  } catch (cause) {
    throw templateFailure('TemplateManifestUnreadable', 'Cannot read the packaged template manifest', cause);
  }

  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch (cause) {
    throw templateFailure('TemplateManifestInvalid', 'The packaged template manifest is not valid JSON', cause);
  }

  let manifest: Manifest;
  try {
    manifest = Schema.decodeUnknownSync(ManifestSchema, { onExcessProperty: 'error', errors: 'all' })(input);
  } catch (cause) {
    throw templateFailure('TemplateManifestInvalid', 'The packaged template manifest does not match concord.templates/v1', cause);
  }

  const names = manifest.templates.map(entry => entry.name);
  const paths = manifest.templates.map(entry => entry.path);
  if (new Set(names).size !== names.length) throw templateFailure('TemplateManifestInvalid', 'The packaged template manifest contains duplicate names');
  if (new Set(paths).size !== paths.length) throw templateFailure('TemplateManifestInvalid', 'The packaged template manifest contains duplicate paths');

  const missingNames = TEMPLATE_NAMES.filter(name => !names.includes(name));
  if (missingNames.length > 0) throw templateFailure('TemplateManifestInvalid', `The packaged template manifest is missing: ${missingNames.join(', ')}`);
  for (const entry of manifest.templates) {
    if (entry.path !== `${entry.name}.md`) throw templateFailure('TemplateManifestInvalid', `Template ${entry.name} must use path ${entry.name}.md`);
  }

  const entries = resources.entries;
  const actual = entries.filter(entry => entry.name !== 'manifest.json').map(entry => entry.name).sort();
  const expected = [...paths].sort();
  const unsupported = entries.filter(entry => entry.name !== 'manifest.json' && !entry.regular).map(entry => entry.name);
  const missingFiles = expected.filter(path => !actual.includes(path));
  const unexpectedFiles = actual.filter(path => !expected.includes(path));
  if (unsupported.length > 0 || missingFiles.length > 0 || unexpectedFiles.length > 0) {
    const details = [
      missingFiles.length > 0 ? `missing: ${missingFiles.join(', ')}` : '',
      unexpectedFiles.length > 0 ? `unexpected: ${unexpectedFiles.join(', ')}` : '',
      unsupported.length > 0 ? `not regular files: ${unsupported.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    throw templateFailure('TemplateInventoryInvalid', `The packaged template inventory does not match its manifest (${details})`);
  }
  return manifest;
}

function findTemplate(resources: TemplateResources, name: string): ManifestEntry {
  const entry = readManifest(resources).templates.find(candidate => candidate.name === name);
  if (entry === undefined) throw templateFailure('TemplateNotFound', `Unknown template: ${name}`);
  return entry;
}

function renderTemplate(resources: TemplateResources, name: string, title: string, pages: readonly TemplatePage[] = TEMPLATE_PAGES): string {
  const entry = findTemplate(resources, name);
  try {
    const entryPoints = pages.length === 0
      ? 'Add supporting pages when needed and link them here. Keep the problem, mental model, and scope in this README.'
      : pages.map(page => `- [${PAGE_DESCRIPTIONS[page].label}](${page === 'use-case' ? 'use-case/README.md' : `${page}.md`})`).join('\n');
    return resources.read(entry.path)
      .replaceAll('{{entryPoints}}', () => entryPoints).replaceAll('{{title}}', () => title);
  } catch (cause) {
    throw templateFailure('TemplateUnreadable', `Cannot read packaged template ${entry.name}`, cause);
  }
}

export const templateBody = Effect.fn('templateBody')(function*(name: string, title: string, pages: readonly TemplatePage[] = TEMPLATE_PAGES) {
  const installation = yield* Installation;
  const resources = yield* installation.templates;
  return yield* Effect.try({ try: () => renderTemplate(resources, name, title, pages), catch: failure });
});
export const templateCatalog = Effect.fn('templateCatalog')(function*() {
  const installation = yield* Installation;
  const resources = yield* installation.templates;
  return yield* Effect.try({ try: () => {
    const manifest = readManifest(resources);
    return { list: manifest.templates.map(({ name, description }) => ({ name, description })),
      render: (name: string, title: string, pages: readonly TemplatePage[] = TEMPLATE_PAGES) => renderTemplate(resources, name, title, pages) };
  }, catch: failure });
});
export const listTemplates = Effect.fn('listTemplates')(function*() { return (yield* templateCatalog()).list; });

/** A complete, readable reference set installed by init; not document owners. */
export function projectTemplateFiles(catalog: { readonly render: (name: string, title: string, pages?: readonly TemplatePage[]) => string }): Record<string, string> {
  const files: Record<string, string> = {};
  const add = (path: string, name: string) => { files[`docs/_template/${path}`] = catalog.render(name, 'Your title'); };
  const packageTemplates = [['feature-design', 'feature'], ['roadmap', 'roadmap']] as const;
  const addPackage = (directory: string, name: string) => {
    add(`${directory}/README.md`, name);
    for (const page of TEMPLATE_PAGES) add(`${directory}/${page === 'use-case' ? 'use-case/README.md' : `${page}.md`}`, page === 'use-case' ? 'use-case-index' : page);
  };
  for (const [directory, name] of packageTemplates) addPackage(directory, name);
  add('engineering/README.md', 'engineering');
  for (const name of ['design', 'use-case', 'issue', 'memory']) add(`${name}/README.md`, name);
  add('taste.md', 'taste');
  add('project-DESIGN.md', 'project-design');
  files['docs/_template/README.md'] = "# Concord writing templates\n\nThis complete reference set is installed by concord init. `concord new` uses the bundled templates, not this directory. These examples are not adopted contracts or test evidence.\n\nA document's path is its identity and its single top-level heading is its name, so templates carry no frontmatter. Issue and Memory frontmatter holds only lifecycle facts, and only when they are non-empty.\n\nFeature, Roadmap, Engineering, and Design candidates require README only; choose the other pages when creating them. Design always includes its decision wrapper.\n\n| Optional page | Use when |\n| --- | --- |\n| library | A public programming interface needs exact shapes and examples |\n| cli | Public commands need inputs, outputs, and errors |\n| architecture | Internal entities, boundaries, invariants, and resource lifecycles need explanation |\n| use-case | User goals need an index of complete paths; create actual cases separately |\n\n" + Object.keys(files).map(path => `- [${path.slice('docs/_template/'.length)}](${path.slice('docs/_template/'.length)})`).join('\n') + '\n';
  return files;
}
