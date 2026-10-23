#!/usr/bin/env node
// Keep ordinary help independent of consumer host code.
try {
  if (process.argv.includes('--skill')) {
    // @concord-begin
    // @concord-implements docs/feature/local-sdlc/use-case/onboard-from-template.md#agent-指引的边界
    const { runSkillMain } = await import('./skill.js');
    await runSkillMain(process.argv.slice(2));
    // @concord-end
  } else if (process.argv[2] === 'repo') {
    // @concord-begin
    // @concord-implements docs/feature/local-sdlc/use-case/load-compatible-repository-profile.md
    // @concord-implements docs/feature/neutral-project-governance/use-case/compose-repository-workflows.md
    process.argv.splice(2, 1);
    const entry = './repository/cli.js';
    await import(entry);
    // @concord-end
  } else {
    // @concord-begin
    // @concord-implements docs/feature/local-sdlc/cli.md#通用约定
    await import('./cli.js');
    // @concord-end
  }
} catch (cause) {
  const error = cause as { code?: string; message?: string };
  process.stderr.write(JSON.stringify({ ok: false, error: error.code ?? 'RepositoryProfileFailed', message: error.message ?? String(cause) }) + '\n');
  process.exitCode = 1;
}
