
export const safeRunnerEnvironment = (input: Readonly<Record<string, string | undefined>> = {}): NodeJS.ProcessEnv => { const env = { ...input }; for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key]; return env; };
