import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { pushServerLog } = await import("@/lib/server_log");
  for (const level of ["error", "warn", "info", "log"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      pushServerLog(level, args);
      orig(...args);
    };
  }
}

// Only path and method: request headers can carry the user's API key.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { pushServerLog } = await import("@/lib/server_log");
  pushServerLog("request-error", [`${request.method} ${request.path} (${context.routeType} ${context.routePath})`, err]);
};
