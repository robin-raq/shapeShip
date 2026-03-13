import { describe, it, expect, vi } from 'vitest';

// Mock the logger module before importing process-handlers
vi.mock('../config/logger.js', () => ({
  logger: {
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

/**
 * Tests for process-level error handlers.
 *
 * These verify that unhandled rejections and uncaught exceptions
 * are caught and logged instead of crashing the server silently.
 *
 * Risk mitigated: Node.js v23 throws on unhandled rejections by default,
 * crashing the Express server with no recovery or logging.
 */
describe('Process Error Handlers', () => {
  it('exports registerProcessHandlers, handleUnhandledRejection, and handleUncaughtException', async () => {
    const mod = await import('../process-handlers.js');

    expect(typeof mod.registerProcessHandlers).toBe('function');
    expect(typeof mod.handleUnhandledRejection).toBe('function');
    expect(typeof mod.handleUncaughtException).toBe('function');
  });

  it('registers handlers on the process object when imported', async () => {
    // The module auto-registers on import. After import, process should
    // have at least one listener for each event.
    await import('../process-handlers.js');

    const rejectionListeners = process.listeners('unhandledRejection');
    const exceptionListeners = process.listeners('uncaughtException');

    expect(rejectionListeners.length).toBeGreaterThanOrEqual(1);
    expect(exceptionListeners.length).toBeGreaterThanOrEqual(1);
  });

  it('logs unhandled rejections with error details', async () => {
    const { logger } = await import('../config/logger.js');
    const { handleUnhandledRejection } = await import('../process-handlers.js');

    const testError = new Error('test rejection');
    handleUnhandledRejection(testError, Promise.reject(testError).catch(() => {}));

    expect(logger.fatal).toHaveBeenCalledWith(
      expect.objectContaining({ err: testError }),
      'Unhandled Rejection'
    );
  });

  it('logs unhandled rejections for non-Error reasons', async () => {
    const { logger } = await import('../config/logger.js');
    const { handleUnhandledRejection } = await import('../process-handlers.js');

    handleUnhandledRejection('string reason', Promise.resolve());

    expect(logger.fatal).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Unhandled Rejection'
    );
  });
});
