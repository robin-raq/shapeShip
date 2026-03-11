import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

// Mock pool before imports
vi.mock('../db/client.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

// Mock visibility
vi.mock('../middleware/visibility.js', () => ({
  isWorkspaceAdmin: vi.fn().mockResolvedValue(false),
  getVisibilityContext: vi.fn().mockResolvedValue({ isAdmin: false }),
  VISIBILITY_FILTER_SQL: () => '(TRUE)',
}));

// Mock auth middleware to auto-set userId/workspaceId
vi.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = 'test-user-id';
    req.workspaceId = 'test-workspace-id';
    next();
  },
  superAdminMiddleware: (_req: any, _res: any, next: any) => next(),
  workspaceAdminMiddleware: (_req: any, _res: any, next: any) => next(),
  workspaceAccessMiddleware: (_req: any, _res: any, next: any) => next(),
  csrfMiddleware: (_req: any, _res: any, next: any) => next(),
}));

// Mock document-crud utilities
vi.mock('../utils/document-crud.js', () => ({
  getBelongsToAssociationsBatch: vi.fn().mockResolvedValue(new Map()),
  logDocumentChange: vi.fn(),
  getTimestampUpdates: vi.fn().mockReturnValue({ setClauses: [], values: [] }),
  TRACKED_FIELDS: {},
  getBelongsToAssociations: vi.fn().mockResolvedValue([]),
}));

import { pool } from '../db/client.js';

// Generate fake document rows
function makeDocRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `doc-${i}`,
    workspace_id: 'test-workspace-id',
    document_type: 'wiki',
    title: `Document ${i}`,
    parent_id: null,
    position: i,
    ticket_number: null,
    properties: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: 'test-user-id',
    visibility: 'workspace',
  }));
}

function makeIssueRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `issue-${i}`,
    title: `Issue ${i}`,
    properties: { state: 'backlog', priority: 'medium' },
    ticket_number: i + 1,
    content: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: 'test-user-id',
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    reopened_at: null,
    converted_from_id: null,
    assignee_name: null,
    assignee_archived: false,
    created_by_name: 'Test User',
  }));
}

describe('API pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/documents', () => {
    function findDocQuery() {
      const calls = (pool.query as any).mock.calls;
      return calls.find((c: any[]) =>
        typeof c[0] === 'string' && c[0].includes('workspace_id') && c[0].includes('ORDER BY')
        && !c[0].includes("document_type = 'issue'")
      );
    }

    it('returns paginated results with default limit', async () => {
      (pool.query as any).mockResolvedValue({ rows: makeDocRows(50), rowCount: 50 });

      const { createApp } = await import('../app.js');
      const app = await createApp();
      const res = await request(app).get('/api/documents');

      expect(res.status).toBe(200);
      const docQuery = findDocQuery();
      expect(docQuery?.[0]).toContain('LIMIT');
    }, 15000);

    it('respects custom limit parameter', async () => {
      (pool.query as any).mockResolvedValue({ rows: makeDocRows(10), rowCount: 10 });

      const { createApp } = await import('../app.js');
      const app = await createApp();
      const res = await request(app).get('/api/documents?limit=10');

      expect(res.status).toBe(200);
      const docQuery = findDocQuery();
      expect(docQuery?.[0]).toContain('LIMIT');
    });

    it('respects offset parameter', async () => {
      (pool.query as any).mockResolvedValue({ rows: makeDocRows(10), rowCount: 10 });

      const { createApp } = await import('../app.js');
      const app = await createApp();
      const res = await request(app).get('/api/documents?limit=10&offset=20');

      expect(res.status).toBe(200);
      const docQuery = findDocQuery();
      expect(docQuery?.[0]).toContain('OFFSET');
    });
  });

  describe('GET /api/issues', () => {
    it('returns paginated results with default limit', async () => {
      (pool.query as any).mockResolvedValue({ rows: makeIssueRows(50), rowCount: 50 });

      const { createApp } = await import('../app.js');
      const app = await createApp();
      const res = await request(app).get('/api/issues');

      expect(res.status).toBe(200);
      // Find the issues query (the one with document_type = 'issue')
      const calls = (pool.query as any).mock.calls;
      const issueQuery = calls.find((c: any[]) => typeof c[0] === 'string' && c[0].includes("document_type = 'issue'"));
      expect(issueQuery?.[0]).toContain('LIMIT');
    });
  });
});
