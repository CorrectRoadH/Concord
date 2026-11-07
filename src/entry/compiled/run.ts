// @concord-file
// @concord-implements docs/engineering/build/architecture.md#编译入口

/** Select before loading any role or capturing its invocation environment. */
export async function run(): Promise<void> {
  if (process.argv[2] === '--api') {
    const { runCompilerSupervisor } = await import('../../base/process/typescript-supervisor.ts');
    const { packageRoot } = await import('../../base/installation/location.ts');
    await runCompilerSupervisor(packageRoot, process.argv.slice(2));
    return;
  }
  if (process.argv[2] !== '--concord-internal') {
    await (await import('../cli/run.ts')).run();
    return;
  }

  const name = process.argv[3];
  process.argv.splice(2, 2);
  switch (name) {
    case 'compute-worker': await (await import('../server/compute-worker-main.ts')).run(); return;
    case 'editor-worker': await (await import('../server/editor-worker-main.ts')).run(); return;
    case 'query-refresh-worker': await (await import('../server/query-refresh-worker-main.ts')).run(); return;
    case 'query-scan-worker': await (await import('../server/query-scan-worker-main.ts')).run(); return;
    case 'view-scan-worker': await (await import('../server/view-scan-worker-main.ts')).run(); return;
    case 'cache-maintenance-worker': await (await import('../server/cache-maintenance-worker-main.ts')).run(); return;
    case 'test-adapter-vitest': await (await import('../server/test-adapter-vitest-main.ts')).run(); return;
    case 'operation-worker': await (await import('../server/operation/run.ts')).run(); return;
    default:
      process.stderr.write(`${JSON.stringify({ ok: false, error: 'UnknownInternalEntry', message: `Unknown Concord internal entry: ${name ?? '(missing)'}` })}\n`);
      process.exitCode = 1;
  }
}
