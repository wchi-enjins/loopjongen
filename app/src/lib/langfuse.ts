/**
 * Langfuse tracing for deep search (benchmarks/law_retrieval/deep). Off unless LANGFUSE_PUBLIC_KEY and
 * LANGFUSE_SECRET_KEY are set; LANGFUSE_BASE_URL picks the region or a self-hosted server. When off, the
 * observations from @langfuse/tracing are no-ops.
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";

export { propagateAttributes, startActiveObservation, startObservation } from "@langfuse/tracing";

/** Starts tracing if it is configured; the returned function flushes and stops it (await it before exit). */
export function startTracing(): () => Promise<void> {
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) return async () => {};
  const sdk = new NodeSDK({ spanProcessors: [new LangfuseSpanProcessor()] });
  sdk.start();
  // A failed export must not crash a finished run.
  return () => sdk.shutdown().catch((e) => console.error(`Langfuse export failed: ${e?.message ?? e}`));
}
