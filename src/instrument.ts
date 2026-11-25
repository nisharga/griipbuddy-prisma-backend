/**
 * Loaded first by server.ts (before Express and everything else), so Sentry can
 * hook into the app from the start. Does nothing without SENTRY_DSN.
 */
import { initSentry } from "@/shared/sentry";

initSentry();
