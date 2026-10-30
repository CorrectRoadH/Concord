
export const safeRunnerEnvironment = (): NodeJS.ProcessEnv => { const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key]; return env; };
