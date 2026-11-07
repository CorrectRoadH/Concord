// @concord-file
// @concord-implements docs/engineering/testing/architecture.md#bun-测试引擎
import { parser } from '@lezer/xml';
import { Schema } from 'effect';
import { resolve } from 'node:path';

export class BunTestReportInvalid extends Schema.TaggedError<BunTestReportInvalid>()('BunTestReportInvalid', {
  message: Schema.String,
}) {}

const Milliseconds = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
const Timings = Schema.Struct({ version: Schema.Literal(1), files: Schema.Record(Schema.String, Milliseconds) });

/** A new official timings file is the completion receipt, including zero-case files. */
export function readBunCompletion(text: string, file: string, cwd: string): number {
  const report = Schema.decodeUnknownSync(Schema.fromJsonString(Timings), { onExcessProperty: 'error' })(text);
  const entries = Object.entries(report.files);
  if (entries.length !== 1 || resolve(cwd, entries[0]![0]) !== file) {
    throw new BunTestReportInvalid({ message: `Official Bun timings did not complete exactly ${file}` });
  }
  return entries[0]![1];
}

type XmlNode = ReturnType<typeof parser.parse>['topNode'];
const Count = Schema.NumberFromString.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)));
const Root = Schema.Struct({ name: Schema.String, tests: Count, assertions: Count, failures: Count, skipped: Count,
  time: Schema.NumberFromString.pipe(Schema.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))) });

/** Project the official XML tree; the XML grammar and error recovery belong to Lezer. */
export function readBunCases(text: string, file: string, cwd: string) {
  const tree = parser.parse(text);
  let invalid = false;
  tree.iterate({ enter(node) { if (node.type.isError || node.name === 'DoctypeDecl') invalid = true; } });
  if (invalid || /<!\s*(?:DOCTYPE|ENTITY)/iu.test(text)) throw new BunTestReportInvalid({ message: 'Invalid official Bun JUnit XML' });
  const slice = (node: XmlNode) => text.slice(node.from, node.to);
  const decode = (value: string): string => value.replace(/&([^;]+);/gu, (_whole, entity: string) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(named, entity)) return named[entity]!;
    if (/^#(?:[0-9]+|x[\da-f]+)$/iu.test(entity)) {
      const code = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) return String.fromCodePoint(code);
    }
    throw new BunTestReportInvalid({ message: 'Invalid JUnit entity' });
  });
  const opening = (node: XmlNode) => node.getChild('OpenTag') ?? node.getChild('SelfClosingTag');
  const tag = (node: XmlNode) => {
    const name = opening(node)?.getChild('TagName');
    if (!name) throw new BunTestReportInvalid({ message: 'Missing JUnit element name' });
    return slice(name);
  };
  const attributes = (node: XmlNode) => {
    const result: Record<string, string> = {};
    for (const attribute of opening(node)?.getChildren('Attribute') ?? []) {
      const key = attribute.getChild('AttributeName'), value = attribute.getChild('AttributeValue');
      if (!key || !value || Object.hasOwn(result, slice(key))) throw new BunTestReportInvalid({ message: 'Invalid JUnit attributes' });
      result[slice(key)] = decode(slice(value).slice(1, -1));
    }
    return result;
  };
  const elements = tree.topNode.getChildren('Element');
  if (elements.length !== 1 || tag(elements[0]!) !== 'testsuites') throw new BunTestReportInvalid({ message: 'Missing JUnit testsuites root' });
  const root = Schema.decodeUnknownSync(Root, { onExcessProperty: 'error' })(attributes(elements[0]!));
  const failures: { name: string; error: string }[] = [];
  let tests = 0, skipped = 0;
  const visit = (node: XmlNode): void => {
    const name = tag(node), attrs = attributes(node);
    if (name === 'testsuites' || name === 'testsuite') {
      if (name === 'testsuite' && (attrs.file === undefined || resolve(cwd, attrs.file) !== file)) {
        throw new BunTestReportInvalid({ message: `Unexpected JUnit file in ${file}` });
      }
      for (const child of node.getChildren('Element')) visit(child);
      return;
    }
    if (name !== 'testcase' || attrs.name === undefined || attrs.file === undefined || resolve(cwd, attrs.file) !== file) {
      throw new BunTestReportInvalid({ message: `Unexpected JUnit element or file in ${file}` });
    }
    const children = node.getChildren('Element');
    const skippedCase = children.filter(child => tag(child) === 'skipped');
    const failedCase = children.filter(child => tag(child) === 'failure');
    if (skippedCase.length > 1 || failedCase.length > 1 || skippedCase.length + failedCase.length !== children.length
      || skippedCase.length + failedCase.length > 1) throw new BunTestReportInvalid({ message: 'Invalid JUnit case result' });
    if (skippedCase.length) skipped++;
    else tests++;
    for (const failure of failedCase) {
      const close = failure.getChild('CloseTag');
      const body = close ? text.slice(opening(failure)!.to, close.from) : '';
      failures.push({ name: attrs.name, error: body ? decode(body) : attributes(failure).message ?? '' });
    }
  };
  visit(elements[0]!);
  if (root.tests !== tests + skipped || root.failures !== failures.length || root.skipped !== skipped) {
    throw new BunTestReportInvalid({ message: 'Official Bun JUnit counts disagree with its cases' });
  }
  return { counts: { tests, failed: failures.length, cancelled: 0, skipped }, failures };
}
