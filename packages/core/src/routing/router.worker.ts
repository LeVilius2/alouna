import { createRoutingHandler, type RoutingRequest } from './worker-protocol';

const handle = createRoutingHandler();
globalThis.addEventListener('message', (event: MessageEvent<RoutingRequest>) => {
  globalThis.postMessage(handle(event.data));
});
