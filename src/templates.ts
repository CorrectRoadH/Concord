// @concord-file writing-template-inventory
// @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md
import { readFileSync, readdirSync, type Dirent } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Schema } from 'effect';
import { ConcordError } from './shared.js';
import { TEMPLATE_PAGES, PAGE_DESCRIPTIONS, type TemplatePage } from './template-pages.js';
export { TEMPLATE_PAGES, type TemplatePage } from './template-pages.js';

const TEMPLATE_NAMES = [
  'feature', 'roadmap', 'design', 'engineering', 'use-case', 'research', 'problem', 'decision', 'insight', 'note', 'issue',
  'library', 'cli', 'architecture', 'lifecycle', 'use-case-index', 'goals', 'limits', 'decision-record', 'cases',
  'project-index', 'concepts', 'project-architecture', 'constitution', 'project-design',
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

const templatesDirectory = fileURLToPath(new URL('../templates/', import.meta.url));
const manifestPath = fileURLToPath(new URL('../templates/manifest.json', import.meta.url));

function templateFailure(code: string, message: string, cause?: unknown): ConcordError {
  return new ConcordError(code, message, cause);
}

function readManifest(): Manifest {
  let source: string;
  try {
    source = readFileSync(manifestPath, 'utf8');
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

  let entries: Dirent<string>[];
  try {
    entries = readdirSync(templatesDirectory, { withFileTypes: true, encoding: 'utf8' });
  } catch (cause) {
    throw templateFailure('TemplateInventoryUnreadable', 'Cannot inspect the packaged template inventory', cause);
  }
  const actual = entries.filter(entry => entry.name !== 'manifest.json').map(entry => entry.name).sort();
  const expected = [...paths].sort();
  const unsupported = entries.filter(entry => entry.name !== 'manifest.json' && !entry.isFile()).map(entry => entry.name);
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

function findTemplate(name: string): ManifestEntry {
  const entry = readManifest().templates.find(candidate => candidate.name === name);
  if (entry === undefined) throw templateFailure('TemplateNotFound', `Unknown template: ${name}`);
  return entry;
}

export function templateBody(name: string, title: string, pages: readonly TemplatePage[] = TEMPLATE_PAGES): string {
  const entry = findTemplate(name);
  try {
    const entryPoints = pages.length === 0
      ? 'Add supporting pages when needed and link them here. Keep the problem, mental model, and scope in this README.'
      : pages.map(page => `- [${PAGE_DESCRIPTIONS[page].label}](${page === 'use-case' ? 'use-case/README.md' : `${page}.md`})`).join('\n');
    return readFileSync(new URL(`../templates/${entry.path}`, import.meta.url), 'utf8')
      .replaceAll('{{entryPoints}}', () => entryPoints).replaceAll('{{title}}', () => title);
  } catch (cause) {
    throw templateFailure('TemplateUnreadable', `Cannot read packaged template ${entry.name}`, cause);
  }
}

export function listTemplates(): { name: string; description: string }[] {
  return readManifest().templates.map(({ name, description }) => ({ name, description }));
}

/** A complete, readable reference set installed by init; not document owners. */
export function projectTemplateFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  const add = (path: string, name: string) => { files[`docs/_template/${path}`] = templateBody(name, 'Your title'); };
  const packageTemplates = [['feature-design', 'feature'], ['roadmap', 'roadmap']] as const;
  const addPackage = (directory: string, name: string) => {
    add(`${directory}/README.md`, name);
    for (const page of TEMPLATE_PAGES) add(`${directory}/${page === 'use-case' ? 'use-case/README.md' : `${page}.md`}`, page === 'use-case' ? 'use-case-index' : page);
  };
  for (const [directory, name] of packageTemplates) addPackage(directory, name);
  add('engineering/README.md', 'engineering');
  add('design-decision/README.md', 'design');
  for (const [file, name] of [['GOALS', 'goals'], ['LIMITS', 'limits'], ['DECISION', 'decision-record'], ['CASES', 'cases']]) add(`design-decision/${file}.md`, name!);
  addPackage('design-decision/plans/plan-1', 'feature');
  addPackage('design-decision/plans/plan-2', 'feature');
  for (const name of ['research', 'use-case', 'issue']) add(`${name}/README.md`, name);
  for (const name of ['problem', 'decision', 'insight', 'note']) add(`memory/${name}.md`, name);
  add('constitution.md', 'constitution');
  add('project-DESIGN.md', 'project-design');
  files['docs/_template/README.md'] = '# Concord writing templates\n\nThis complete reference set is installed by concord init. Create commands use bundled templates, not editable configuration from this directory. These examples are not adopted contracts or test evidence.\n\nFeature, Roadmap, and Design candidates require README only. Select optional pages with --pages library,cli,architecture,lifecycle,use-case (or repeat --pages). Omitted pages use project defaults; --no-pages explicitly creates README only. Design always includes its decision wrapper. Engineering starts with goal, mechanism, usage, and acceptance in README; expand with page add when needed.\n\n| Optional page | Use when |\n| --- | --- |\n| library | A public programming interface needs exact shapes and examples |\n| cli | Public commands need inputs, outputs, and errors |\n| architecture | Internal entities, boundaries, and invariants need explanation |\n| lifecycle | Resources or state transitions need ownership and cleanup rules |\n| use-case | User goals need an index of complete paths; create actual cases separately |\n\n' + Object.keys(files).map(path => `- [${path.slice('docs/_template/'.length)}](${path.slice('docs/_template/'.length)})`).join('\n') + '\n';
  return files;
}
