import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger.js';

/**
 * Global Express error-handling middleware.
 *
 * Catches all errors that route handlers pass to next(err),
 * including JSON parse failures from express.json().
 *
 * Returns a consistent { error: { code, message } } JSON format
 * matching the auth middleware pattern.
 */
export function errorHandler(
  err: Error & { status?: number; statusCode?: number; type?: string },
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Determine HTTP status — use err.status/statusCode, or default to 500
  const status = err.status || err.statusCode || 500;

  // Map known error types to structured codes
  let code = 'INTERNAL_ERROR';
  let message = 'Internal server error';

  if (err.type === 'entity.parse.failed') {
    // JSON parse error from express.json()
    code = 'VALIDATION_ERROR';
    message = 'Invalid JSON body';
  } else if (status === 400) {
    code = 'BAD_REQUEST';
    message = err.message || 'Bad request';
  } else if (status === 401) {
    code = 'UNAUTHORIZED';
    message = err.message || 'Unauthorized';
  } else if (status === 403) {
    code = 'FORBIDDEN';
    message = err.message || 'Forbidden';
  } else if (status === 404) {
    code = 'NOT_FOUND';
    message = err.message || 'Not found';
  } else if (status >= 500) {
    // Log server errors — these indicate real bugs
    logger.error({ err, status }, 'Unhandled server error');
  }

  res.status(status).json({
    error: {
      code,
      message,
    },
  });
}

/**
 * Catch-all for requests that don't match any route.
 * Must be registered AFTER all routes but BEFORE the error handler.
 */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'The requested API endpoint does not exist',
    },
  });
}
