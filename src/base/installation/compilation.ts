/** Replaced by Bun's build define; runtime environment cannot select this mode. */
declare const CONCORD_COMPILED: boolean;
export const compiledInstallation = typeof CONCORD_COMPILED !== 'undefined' && CONCORD_COMPILED;
