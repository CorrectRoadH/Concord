/** Exported for smoke/audit tooling; never returns or logs a variable value. */
export declare function isSensitiveEnvName(name: string): boolean;
/** Values are derived at the process boundary and only passed to pure folds. */
export declare function sensitiveEnvValues(env: NodeJS.ProcessEnv): readonly string[];
/** Pure receipt/log fold: never return a secret value, including overlapping values. */
export declare function redactSecretText(text: string, secretValues: readonly string[]): string;
export declare function redactSecretStrings(values: readonly string[], secretValues: readonly string[]): string[];
export declare function redactSecretCapture<T extends {
    stdout: string;
    stderr: string;
    error?: string | undefined;
}>(capture: T, secretValues: readonly string[]): T;
/**
 * Build the environment a single repo's isolated command runs under.
 *
 * Starts from the orchestrator's own process env (so PATH/HOME/etc. and
 * ordinary operational env survive), strips every declared matrix secret and
 * every sensitive-name variable that this repo did not declare, then adds
 * back only this repo's own declared values. This makes unknown local/CI
 * credentials fail closed without needing to enumerate their values.
 */
export declare function buildChildEnv(baseEnv: NodeJS.ProcessEnv, allDeclaredSecretNames: ReadonlySet<string>, thisRepoSecrets: readonly string[], repoId?: string): NodeJS.ProcessEnv;
