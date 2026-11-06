#!/usr/bin/env node
// Keep ordinary help independent of consumer host code.
try {
  if (process.argv.includes('--skill')) {
    // @concord-begin
    // @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md#agent-指引的边界
    const { runSkillMain } = await import("./skill.ts");
    await runSkillMain(process.argv.slice(2));
    // @concord-end
  } else {
    // @concord-begin
    // @concord-implements docs/feature/local-sdlc/cli.md#通用约定
    const cli = import.meta.url.endsWith('.ts') ? './cli-fallback.ts' : './cli-fallback-bundle.js';
    await import(cli);
    // @concord-end
  }
} catch (cause) {
  const error = cause as { code?: string; message?: string };
  process.stderr.write(JSON.stringify({ ok: false, error: error.code ?? 'OperationFailed', message: error.message ?? String(cause) }) + '\n');
  process.exitCode = 1;
}
