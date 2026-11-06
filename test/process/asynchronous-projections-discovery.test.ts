// 跨进程保证：服务与 IPC——CLI 退出后后台扫描发布投影，后续 CLI 读取历史结果。
import { assert, installedCall, packedConsumer, refreshInstalled, rmSync, test, waitForRefreshExit } from '../support/asynchronous-projections-fixture.ts';

// @use-case docs/feature/local-sdlc/use-case/discover-annotated-tests.md
test('CLI background discovery publishes a historical projection after the requesting command exits', async () => {
  const root = packedConsumer(false);
  try {
    const refreshed = await refreshInstalled(root, ['trace', 'gaps']);
    assert.equal(refreshed.status, 0, refreshed.stderr);
    // Read through the packed public CLI after the background scan has published.
    const historical = installedCall(root, '--json', 'trace', 'gaps');
    assert.equal(historical.status, 0, historical.stderr);
    assert.equal(JSON.parse(historical.stdout).projection.current, false);
  } finally { await waitForRefreshExit(root); rmSync(root, { recursive: true, force: true }); }
});
