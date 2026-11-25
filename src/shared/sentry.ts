import * as Sentry from "@sentry/node";
import config from "@/config";

/**
 * Error tracking with Sentry (https://sentry.io). Off when SENTRY_DSN is empty.
 *
 * What gets reported (each with the stack trace, URL and user id):
 *   • request errors that become a 500 (globalErrorHandler) — not 4xx like "not found"
 *   • failed background jobs and cron runs
 *   • crashes: uncaught exceptions / unhandled promise rejections
 *
 * Passwords, codes and tokens are removed before anything is sent (see `scrub`).
 */

/** Field names that may hold secrets: password, old_password, otp, code, refresh_token, x-api-key … */
const SECRET_KEY = /pass(word)?|^otp$|^code$|token|secret|authorization|cookie|api[_-]?key/i;

/** Replace secret-looking fields (at any depth) with "[removed]". */
export const scrub = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [key, SECRET_KEY.test(key) ? "[removed]" : scrub(inner)])
  );
};

/** True when SENTRY_DSN is set (never in tests). */
const enabled = (): boolean => !!config.sentry;

/** Start Sentry. Call once, as early as possible (first line of server.ts). */
export const initSentry = (): void => {
  if (!config.sentry) return;

  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.sentry.environment,
    tracesSampleRate: config.sentry.tracesSampleRate,
    // Collect as little as possible: passwords, OTP codes and SMS texts must never leave the server.
    dataCollection: {
      userInfo: false, // only the user id, set by reportError
      cookies: false,
      httpHeaders: { request: { deny: ["authorization", "cookie", "x-api-key"] }, response: false },
      httpBodies: [], // the request body is attached by reportError, after scrub()
      urlQueryParams: true,
      databaseQueryData: false,
      queues: false, // job data includes SMS texts with login codes
      stackFrameVariables: false, // local variables can hold passwords / codes
    },
    // server.ts handles crashes itself (reports, then shuts down cleanly),
    // so Sentry's own crash handlers are turned off to avoid double reports.
    integrations: (defaults) =>
      defaults.filter(
        (integration) => !["OnUncaughtException", "OnUnhandledRejection"].includes(integration.name)
      ),
    beforeSend: (event) => {
      if (event.request) {
        event.request.data = scrub(event.request.data);
        event.request.headers = scrub(event.request.headers) as Record<string, string>;
        event.request.cookies = undefined;
      }
      if (event.extra) event.extra = scrub(event.extra) as Record<string, unknown>;
      return event;
    },
  });
};

/** Send one error to Sentry, with optional context (tags are searchable in Sentry). */
export const reportError = (
  error: unknown,
  context: { tags?: Record<string, string>; extra?: Record<string, unknown>; userId?: string } = {}
): void => {
  if (!enabled()) return;

  Sentry.withScope((scope) => {
    if (context.tags) scope.setTags(context.tags);
    if (context.extra) scope.setExtras(scrub(context.extra) as Record<string, unknown>);
    if (context.userId) scope.setUser({ id: context.userId });
    Sentry.captureException(error);
  });
};

/** Wait (up to 2 s) for queued reports to be sent — call before the process exits. */
export const flushSentry = async (): Promise<void> => {
  if (!enabled()) return;
  await Sentry.close(2000).catch(() => undefined);
};
