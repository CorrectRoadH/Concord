// @concord-file
// @concord-implements docs/feature/local-data-engine/architecture.md#进程与资源
import { Effect } from 'effect';
import { RpcClient } from 'effect/unstable/rpc';
import { Socket } from 'effect/unstable/socket';

export const makeComputationProtocol = (socket: Socket.Socket) => RpcClient.makeProtocolSocket({ retryTransientErrors: false }).pipe(Effect.provideService(Socket.Socket, socket));
