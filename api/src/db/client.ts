import pg from 'pg';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../config/logger.js';
import type { QueryParam } from '../types/db-rows.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables before creating pool
config({ path: join(__dirname, '../../.env.local') });
config({ path: join(__dirname, '../../.env') });

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Production-ready pool configuration
  max: isProduction ? 20 : 10, // Max connections (default is 10)
  idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
  connectionTimeoutMillis: 2000, // Fail fast if can't connect in 2 seconds
  maxUses: 7500, // Recycle connections after 7500 queries to prevent memory leaks
  // DDoS protection: Terminate queries running longer than 30 seconds
  statement_timeout: 30000, // 30 seconds max query duration
});

// Graceful shutdown - close pool connections on process termination
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, closing database pool');
  await pool.end();
  logger.info('Database pool closed');
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, closing database pool');
  await pool.end();
  logger.info('Database pool closed');
  process.exit(0);
});

/**
 * Type-safe single-row query. Returns the first row typed as T, or null.
 * Uses pg's built-in generic support: pool.query<T>() → QueryResult<T>.
 */
export async function queryRow<T extends pg.QueryResultRow>(sql: string, params: QueryParam[]): Promise<T | null> {
  const result = await pool.query<T>(sql, params);
  return result.rows[0] ?? null;
}

/**
 * Type-safe multi-row query. Returns all rows typed as T[].
 * Uses pg's built-in generic support: pool.query<T>() → QueryResult<T>.
 */
export async function queryRows<T extends pg.QueryResultRow>(sql: string, params: QueryParam[]): Promise<T[]> {
  const result = await pool.query<T>(sql, params);
  return result.rows;
}

export { pool };
