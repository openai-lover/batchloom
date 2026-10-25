import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

// A dedicated worker holds the model and prompt in memory. No payment tools exist here.
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (event: MessageEvent) => handler.onmessage(event);
