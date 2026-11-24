// 跨进程保证：文件监听——独立的工作区服务进程在 docs 外的状态图模型或产物变动后刷新投影。
// 模型变动后，HTTP check action、GET /api/workspace 与 --server existing 返回相同的 StatechartStale；重新生成并更新摘要后，投影清除此 finding。
import assert from 'node:assert/strict';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { statechartDigest } from '../../src/model/index.ts';
import { runCli } from '../support/cli.ts';
import { createConsumer } from '../support/consumer.ts';
import { fetchFresh, fetchWorkspaceProjection, parseWorkspaceProjectionOutput, pollUntil, waitForWorkspaceProjection } from '../support/support.ts';
import { startViewServer } from '../support/view-server.ts';

// @feature docs/feature/documentation-quality/cli.md#合并检查
test('workspace projection follows external statechart inputs and clears stale after regeneration', async () => {
  const root = await createConsumer();
  const document = 'docs/feature/queue/statechart.md';
  const model = 'tla/Queue.tla', config = 'tla/queue.cfg', view = 'tla/labels.ts';
  const chart = 'tla/out/queue/chart.mmd', report = 'tla/out/queue/report.md';
  const inputs = new Map<string, Uint8Array>();
  const write = (path: string, text: string) => {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target + '.next', text);
    renameSync(target + '.next', target);
  };
  const setInput = (path: string, text: string) => {
    inputs.set(path, new TextEncoder().encode(text));
    write(path, text);
  };
  const declare = (hash: string) => write(document, '# Queue states\n\n~~~statechart'
    + ` spec="../../../${model}" config="../../../${config}" view="../../../${view}" out="../../../tla/out/queue" digest="${hash}"\n~~~\n`);
  let server: Awaited<ReturnType<typeof startViewServer>> | undefined;
  try {
    write('docs/feature/queue/README.md', '# Queue\n');
    setInput(model, 'first model\n');
    setInput(config, 'first configuration\n');
    setInput(view, 'export {};\n');
    write(chart, 'stateDiagram-v2\n[*] --> Ready\n');
    write(report, '# Queue report\n');
    const initialHash = statechartDigest(inputs);
    declare(initialHash);
    server = await startViewServer({ root });
    const base = new URL(server.address).origin;
    let projection = await waitForWorkspaceProjection(base);
    const findings = () => projection.snapshot.findings.filter(finding => finding.path === document);
    assert.deepEqual(findings(), []);
    const refresh = async (description: string) => {
      const previous = projection.projection.sourceDigest;
      projection = await pollUntil(async () => {
        const candidate = await fetchWorkspaceProjection(base);
        return candidate.projection.sourceDigest === previous ? undefined : candidate;
      }, { description, timeoutMs: 12_000 });
    };

    setInput(model, 'changed model\n');
    await refresh('workspace projection observes a model edit outside docs');
    assert.deepEqual(findings().map(finding => [finding.category, finding.code, finding.line, finding.details]), [
      ['relation', 'StatechartStale', 3, { expected: initialHash, actual: statechartDigest(inputs) }],
    ]);
    assert.equal(projection.snapshot.complete, true);
    const checked = await fetchFresh(`${base}/api/action`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'check' }),
    });
    assert.equal(checked.status, 200);
    const check: { value: { findings: unknown[] } } = await checked.json();
    assert.deepEqual(check.value.findings, findings());
    const cli = await runCli({ argv: ['--root', root, '--server', 'existing', '--json', 'workspace', 'projection'], cwd: root, env: process.env });
    assert.equal(cli.exitCode, 0, cli.stderr);
    assert.deepEqual(parseWorkspaceProjectionOutput(cli.stdout).snapshot.findings, findings());

    for (const [path, text] of [[config, 'changed configuration\n'], [view, 'export const label = "ready";\n']] as const) {
      setInput(path, text);
      await refresh(`workspace projection observes ${path}`);
      assert.deepEqual(findings()[0]?.details, { expected: initialHash, actual: statechartDigest(inputs) });
    }
    setInput('tla/Support.tla', 'new sibling module\n');
    await refresh('workspace projection observes a new sibling module');
    assert.deepEqual(findings()[0]?.details, { expected: initialHash, actual: statechartDigest(inputs) });
    write(chart, 'stateDiagram-v2\n[*] --> Running\n');
    await refresh('workspace projection observes regenerated chart');
    assert.equal(findings()[0]?.code, 'StatechartStale');
    rmSync(join(root, report));
    await refresh('workspace projection notices the missing report');
    assert.deepEqual(findings().map(finding => finding.code).sort(), ['StatechartReportNotFound', 'StatechartStale']);
    write(report, '# Regenerated report\n');
    await refresh('workspace projection observes regenerated report');
    assert.deepEqual(findings().map(finding => finding.code), ['StatechartStale']);
    declare(statechartDigest(inputs));
    await refresh('workspace projection clears the finding after the digest is updated');
    assert.deepEqual(findings(), []);
  } finally {
    try { await server?.close(); }
    finally { rmSync(root, { recursive: true, force: true }); }
  }
});
