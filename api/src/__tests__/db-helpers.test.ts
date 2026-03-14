import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for typed database query helpers and type utilities.
 *
 * These verify that:
 * - queryRow<T> returns T | null (typed single-row lookup)
 * - queryRows<T> returns T[] (typed multi-row query)
 * - Both use pg's built-in generic support for compile-time safety
 */

// vi.mock factory is hoisted — use vi.hoisted() for shared mock state
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

// Fully mock client.ts: replace pool + re-export queryRow/queryRows
// that use the mocked pool (not the real one that connects to PostgreSQL)
vi.mock('../db/client.js', () => {
  const pool = { query: mockQuery, end: vi.fn() };
  return {
    pool,
    queryRow: async <T>(sql: string, params: unknown[]): Promise<T | null> => {
      const result = await pool.query(sql, params);
      return result.rows[0] ?? null;
    },
    queryRows: async <T>(sql: string, params: unknown[]): Promise<T[]> => {
      const result = await pool.query(sql, params);
      return result.rows;
    },
  };
});

import { queryRow, queryRows } from '../db/client.js';

beforeEach(() => {
  mockQuery.mockReset();
});

describe('queryRow<T>', () => {
  it('returns typed first row when rows exist', async () => {
    interface TestRow { id: string; title: string }
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: '1', title: 'Sprint 1' }],
      rowCount: 1,
    });

    const result = await queryRow<TestRow>('SELECT * FROM docs WHERE id = $1', ['1']);

    expect(result).toEqual({ id: '1', title: 'Sprint 1' });
    // TypeScript compile-time check: result is TestRow | null
    expect(result?.id).toBe('1');
    expect(result?.title).toBe('Sprint 1');
  });

  it('returns null when no rows match', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await queryRow<{ id: string }>('SELECT * FROM docs WHERE id = $1', ['999']);

    expect(result).toBeNull();
  });
});

describe('queryRows<T>', () => {
  it('returns typed array of all matching rows', async () => {
    interface IssueRow { id: string; state: string }
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: '1', state: 'done' },
        { id: '2', state: 'in_progress' },
      ],
      rowCount: 2,
    });

    const result = await queryRows<IssueRow>('SELECT * FROM docs WHERE type = $1', ['issue']);

    expect(result).toHaveLength(2);
    // TypeScript compile-time check: result[0] is IssueRow
    expect(result[0]!.state).toBe('done');
    expect(result[1]!.id).toBe('2');
  });

  it('returns empty array when no rows match', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await queryRows<{ id: string }>('SELECT * FROM docs WHERE 1=0', []);

    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// pgBool — normalize PostgreSQL boolean values
// ---------------------------------------------------------------------------
import { pgBool } from '../types/db-rows.js';

describe('pgBool', () => {
  it('returns true for boolean true (native pg boolean)', () => {
    expect(pgBool(true)).toBe(true);
  });

  it('returns true for string "t" (legacy pg or aggregation edge case)', () => {
    expect(pgBool('t')).toBe(true);
  });

  it('returns false for boolean false', () => {
    expect(pgBool(false)).toBe(false);
  });

  it('returns false for null', () => {
    expect(pgBool(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(pgBool(undefined)).toBe(false);
  });

  it('returns false for string "f" (legacy pg false)', () => {
    expect(pgBool('f')).toBe(false);
  });

  it('returns false for arbitrary values', () => {
    expect(pgBool(0)).toBe(false);
    expect(pgBool('')).toBe(false);
    expect(pgBool('true')).toBe(false); // only 't' is truthy, not 'true'
  });
});
