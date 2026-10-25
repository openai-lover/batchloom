import { validateBatchPolicy, validateRequestList } from './batch-domain.ts';
import type { AnalyzedRequest, BatchPolicy, Issue, SourceRequest } from './batch-domain.ts';
import { heldForReview, localEvidenceSchema, LOCAL_INPUT_LIMIT, localRequestMessages, validateLocalSpanOutput } from './local-ai-core.ts';

import { LOCAL_MODEL } from './local-model.ts';
export { LOCAL_MODEL } from './local-model.ts';

export type LocalAIPhase = 'checking' | 'loading' | 'analyzing' | 'complete' | 'cancelled' | 'failed';
export interface LocalAIProgress {
  phase: LocalAIPhase;
  message: string;
  /** 0..1 within the current phase, not an invented overall download estimate. */
  progress: number;
  completed: number;
  total: number;
}
export interface LocalAIRecord {
  requestId: string; content: string | null; finishReason: string; elapsedMs: number;
  outputTokens?: number; analyzed: AnalyzedRequest;
}
export interface LocalAIOptions {
  signal?: AbortSignal;
  onProgress?: (progress: LocalAIProgress) => void;
  /** Optional local-only evaluation hook. The normal product does not log raw model output. */
  onRecord?: (record: LocalAIRecord) => void;
  /** Development evaluation only; do not send this message to telemetry. */
  onDiagnostic?: (message: string) => void;
}
export interface LocalAIResult {
  status: 'complete' | 'unsupported' | 'cancelled' | 'failed';
  mode: 'local_ai';
  requests: AnalyzedRequest[];
  issues: Issue[];
  model: string;
  analyzedAt?: string;
  elapsedMs?: number;
  reason?: 'browser_only' | 'webgpu_unavailable' | 'gpu_feature_missing' | 'invalid_input' | 'busy' | 'cancelled' | 'model_error' | 'timeout';
}
interface LocalAdapter { features: { has(name: string): boolean }; }
interface BrowserGPU { requestAdapter(): Promise<LocalAdapter | null>; }
let busy = false;

function failure(status: LocalAIResult['status'], reason: LocalAIResult['reason'], message: string, issues: Issue[] = []): LocalAIResult {
  return { status, reason, mode: 'local_ai', requests: [], model: LOCAL_MODEL.id,
    issues: [{ code: `LOCAL_${String(reason).toUpperCase()}`, field: 'analysis', severity: 'review', message }, ...issues] };
}

export async function checkLocalAISupport(): Promise<{ supported: boolean; reason?: LocalAIResult['reason']; message: string }> {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return { supported: false, reason: 'browser_only', message: 'Local AI runs in a browser on your device.' };
  const gpu = (navigator as Navigator & { gpu?: BrowserGPU }).gpu;
  if (!window.isSecureContext || !gpu) return { supported: false, reason: 'webgpu_unavailable', message: 'This browser does not provide WebGPU. Use a current Chrome or Edge desktop browser with graphics acceleration enabled, or explore the clearly labelled example.' };
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { supported: false, reason: 'webgpu_unavailable', message: 'No compatible graphics device is available. Local AI is unavailable here; no request will be sent to a cloud model.' };
    if (!adapter.features.has('shader-f16')) return { supported: false, reason: 'gpu_feature_missing', message: 'This graphics device lacks the shader-f16 support needed by this model. Use a compatible desktop device or the labelled example.' };
    return { supported: true, message: 'Compatible WebGPU device found. About 1 GB downloads on first use; around 2 GB of GPU memory may be needed. Actual memory and speed vary by device.' };
  } catch {
    return { supported: false, reason: 'webgpu_unavailable', message: 'The browser could not access a compatible graphics device. No cloud model fallback is used.' };
  }
}

/** Call only after an explicit user action. Only model assets are downloaded; inference is local.
 * Publishing a reviewed batch is a separate app action that may send proposal data to its server.
 */
export async function analyzeLocalRequests(requests: SourceRequest[], policy: BatchPolicy, options: LocalAIOptions = {}): Promise<LocalAIResult> {
  if (busy) return failure('failed', 'busy', 'An analysis is already running. Cancel it or wait for it to finish.');
  const sources = validateRequestList(requests);
  const checkedPolicy = validateBatchPolicy(policy);
  if (!sources.valid || !sources.value || !checkedPolicy.valid || !checkedPolicy.value) return failure('failed', 'invalid_input', 'Check the requests and batch settings before analysis.', [...sources.issues, ...checkedPolicy.issues]);
  if (options.signal?.aborted) return failure('cancelled', 'cancelled', 'Analysis cancelled. No request was counted.');
  busy = true;
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectStop: (error: Error) => void = () => {};
  let stopReason: 'cancelled' | 'timeout' | undefined;
  const stopPromise = new Promise<never>((_, reject) => { rejectStop = reject; });
  // The stop promise is raced with each async operation, so cancellation also interrupts downloads.
  const wait = <T>(operation: Promise<T>) => Promise.race([operation, stopPromise]);
  const abort = () => { stopReason = 'cancelled'; worker?.terminate(); rejectStop(new Error('Local analysis cancelled')); };
  options.signal?.addEventListener('abort', abort, { once: true });
  const total = sources.value.length;
  const started = Date.now();
  let completed = 0;
  const progress = (phase: LocalAIPhase, message: string, value = 0) => {
    options.onProgress?.({ phase, message, progress: Math.max(0, Math.min(1, value)), completed, total });
  };
  try {
    progress('checking', 'Checking this device for local AI.');
    const support = await wait(checkLocalAISupport());
    if (!support.supported) return failure('unsupported', support.reason, support.message);
    const webllm = await wait(import('@mlc-ai/web-llm'));
    if (options.signal?.aborted) throw new Error('Cancelled');
    // An origin-relative prebuilt worker avoids SSR framework rewriting import.meta.url to file:.
    worker = new Worker('/local-ai/worker.js', { type: 'module' });
    worker.addEventListener('error', () => rejectStop(new Error('Local model worker failed')));
    const engine = new webllm.WebWorkerMLCEngine(worker, {
      logLevel: 'ERROR',
      appConfig: { cacheBackend: 'cache', model_list: [{
        model_id: LOCAL_MODEL.id, model: LOCAL_MODEL.modelUrl, model_lib: LOCAL_MODEL.wasmUrl,
        vram_required_MB: LOCAL_MODEL.estimatedGpuMemoryMB, low_resource_required: true,
        required_features: ['shader-f16'], overrides: { context_window_size: 4096 },
      }] },
      initProgressCallback: (report) => progress('loading', report.text, report.progress),
    });
    progress('loading', 'Downloading or loading the local model. The first download is about 1 GB.');
    timer = setTimeout(() => { stopReason = 'timeout'; worker?.terminate(); rejectStop(new Error('Model load timed out')); }, 15 * 60_000);
    await wait(engine.reload(LOCAL_MODEL.id));
    clearTimeout(timer);
    const analyzed: AnalyzedRequest[] = [];
    for (const source of sources.value) {
      if (options.signal?.aborted) throw new Error('Cancelled');
      progress('analyzing', `Analyzing request ${completed + 1} of ${total} on this device.`, completed / total);
      if (source.body.length > LOCAL_INPUT_LIMIT) {
        analyzed.push(heldForReview(source, 'LOCAL_INPUT_TOO_LONG', `This request exceeds the local model's ${LOCAL_INPUT_LIMIT}-character limit. It was not truncated or counted; review it manually.`));
      } else {
        // No history from another customer enters this request's context.
        await wait(engine.resetChat());
        const inferenceStarted = Date.now();
        timer = setTimeout(() => { stopReason = 'timeout'; worker?.terminate(); rejectStop(new Error('Inference timed out')); }, 120_000);
        const result = await wait(engine.chat.completions.create({
          messages: localRequestMessages(source), stream: false,
          temperature: 0, seed: 17, max_tokens: 640,
          response_format: { type: 'json_object', schema: JSON.stringify(localEvidenceSchema(source)) },
          extra_body: { enable_thinking: false },
        }));
        clearTimeout(timer);
        const choice = result.choices[0];
        const row = validateLocalSpanOutput(source, checkedPolicy.value, choice?.message?.content, choice?.finish_reason ?? 'invalid');
        analyzed.push(row);
        options.onRecord?.({ requestId: source.id, content: choice?.message?.content ?? null,
          finishReason: choice?.finish_reason ?? 'invalid', elapsedMs: Date.now() - inferenceStarted,
          outputTokens: result.usage?.completion_tokens, analyzed: row });
      }
      completed += 1;
      progress('analyzing', `Reviewed ${completed} of ${total} requests locally.`, completed / total);
    }
    progress('complete', `Local analysis complete. Review all ${total} requests before publishing.`, 1);
    return { status: 'complete', mode: 'local_ai', requests: analyzed, issues: analyzed.flatMap((row) => row.issues.filter((item) => item.code.startsWith('LOCAL_'))), model: LOCAL_MODEL.id, analyzedAt: new Date().toISOString(), elapsedMs: Date.now() - started };
  } catch (error) {
    options.onDiagnostic?.(error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 1200) : 'Local worker rejected the operation.');
    if (stopReason === 'cancelled' || options.signal?.aborted) {
      progress('cancelled', 'Analysis cancelled. No partial results were accepted.');
      return failure('cancelled', 'cancelled', 'Analysis cancelled. Source requests are unchanged and no partial results were accepted.');
    }
    progress('failed', 'Local AI could not finish. Source requests are unchanged.');
    return failure('failed', stopReason === 'timeout' ? 'timeout' : 'model_error', stopReason === 'timeout'
      ? 'The local model timed out. Try fewer short requests on a compatible desktop device.'
      : 'The local model could not load or run. Check the connection for the initial download and available GPU memory. No cloud model fallback was used.');
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    worker?.terminate();
    busy = false;
  }
}


