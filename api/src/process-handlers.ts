/**
 * Process-level error handlers for unhandled rejections and exceptions.
 *
 * Node.js v23 throws on unhandled rejections by default, which would
 * crash the Express server with no logging or recovery. These handlers
 * ensure errors are logged before the process exits.
 */
import { logger } from './config/logger.js';

export function handleUnhandledRejection(
  reason: unknown,
  _promise: Promise<unknown>
): void {
  logger.fatal({ err: reason instanceof Error ? reason : new Error(String(reason)) }, 'Unhandled Rejection');
  // In production, allow the process to exit after logging
  // so the process manager (PM2, ECS, etc.) can restart it
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

export function handleUncaughtException(err: Error): void {
  logger.fatal({ err }, 'Uncaught Exception');
  // Always exit on uncaught exceptions — the process state is unknown
  process.exit(1);
}

/**
 * Register both handlers on the process object.
 * Call this once at server startup.
 */
export function registerProcessHandlers(): void {
  process.on('unhandledRejection', handleUnhandledRejection);
  process.on('uncaughtException', handleUncaughtException);
}

// Auto-register when imported
registerProcessHandlers();
