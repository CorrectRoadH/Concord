#!/usr/bin/env node
// Keep ordinary help independent of consumer host code.
try {
  if (process.argv.includes('--skill')) {
    const { runSkillMain } = await import('./skill.js');
    await runSkillMain(process.argv.slice(2));
  } else if (process.argv[2] === 'repo') {
    process.argv.splice(2, 1);
    const entry = './repository/cli.js';
    await import(entry);
  } else {
    await import('./cli.js');
  }
} catch (cause) {
  const error = cause as { code?: string; message?: string };
  process.stderr.write(JSON.stringify({ ok: false, error: error.code ?? 'RepositoryProfileFailed', message: error.message ?? String(cause) }) + '\n');
  process.exitCode = 1;
}
