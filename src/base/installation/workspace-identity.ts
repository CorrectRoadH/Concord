// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#启动与裁决

export function workspaceIdentity(version: string, digest: string): string {
  return JSON.stringify({ version, digest });
}
