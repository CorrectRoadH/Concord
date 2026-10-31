export { requestWorkspace, subscribeWorkspace, connectWorkspaceSocket, submitFeedback, waitForServerHandshake } from './client.js';
export { WorkspaceRpcs, ReadCodec, FRAME_LIMIT, PROTOCOL, WorkspaceServerError, packets, collectBytes, collectPackets } from './protocol.js';
export type { WorkspaceConnection } from './client.js';
