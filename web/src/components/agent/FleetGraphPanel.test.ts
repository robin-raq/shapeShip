import { describe, it, expect } from 'vitest';
import { parseRouteContext, getSuggestedPrompts, buildChatContext } from './FleetGraphPanel';

describe('parseRouteContext', () => {
  it('extracts issue entity from /issues/:id', () => {
    const ctx = parseRouteContext('/issues/abc-123');
    expect(ctx.entityType).toBe('issue');
    expect(ctx.entityId).toBe('abc-123');
  });

  it('extracts project entity from /projects/:id', () => {
    const ctx = parseRouteContext('/projects/proj-456');
    expect(ctx.entityType).toBe('project');
    expect(ctx.entityId).toBe('proj-456');
  });

  it('extracts program entity from /programs/:id', () => {
    const ctx = parseRouteContext('/programs/prog-789');
    expect(ctx.entityType).toBe('program');
    expect(ctx.entityId).toBe('prog-789');
  });

  it('extracts sprint entity from /sprints/:id', () => {
    const ctx = parseRouteContext('/sprints/sprint-001');
    expect(ctx.entityType).toBe('sprint');
    expect(ctx.entityId).toBe('sprint-001');
  });

  it('extracts document entity from /documents/:id', () => {
    const ctx = parseRouteContext('/documents/doc-uuid');
    expect(ctx.entityType).toBe('document');
    expect(ctx.entityId).toBe('doc-uuid');
  });

  it('returns unknown for unmatched paths', () => {
    expect(parseRouteContext('/docs').entityType).toBe('unknown');
    expect(parseRouteContext('/dashboard').entityType).toBe('unknown');
    expect(parseRouteContext('/settings').entityType).toBe('unknown');
    expect(parseRouteContext('/').entityType).toBe('unknown');
  });

  it('does not include sub-paths in entityId', () => {
    const ctx = parseRouteContext('/issues/abc-123/edit');
    expect(ctx.entityType).toBe('issue');
    expect(ctx.entityId).toBe('abc-123');
  });

  it('handles UUID-style entity IDs', () => {
    const ctx = parseRouteContext('/issues/b9921f8d-4fc5-4fc8-a3d0-234e7bf74f1b');
    expect(ctx.entityType).toBe('issue');
    expect(ctx.entityId).toBe('b9921f8d-4fc5-4fc8-a3d0-234e7bf74f1b');
  });
});

describe('getSuggestedPrompts', () => {
  it('returns dashboard prompts for /dashboard', () => {
    const prompts = getSuggestedPrompts('/dashboard', 'unknown');
    expect(prompts).toContain('What should I focus on today?');
  });

  it('returns dashboard prompts for /my-week', () => {
    const prompts = getSuggestedPrompts('/my-week', 'unknown');
    expect(prompts).toContain('What should I focus on today?');
  });

  it('returns dashboard prompts for root path', () => {
    const prompts = getSuggestedPrompts('/', 'unknown');
    expect(prompts).toContain('What should I focus on today?');
  });

  it('returns sprint prompts for sprint entity type', () => {
    const prompts = getSuggestedPrompts('/sprints/123', 'sprint');
    expect(prompts).toContain("How's this sprint tracking?");
  });

  it('returns issue prompts for issue entity type', () => {
    const prompts = getSuggestedPrompts('/issues/abc', 'issue');
    expect(prompts).toContain("What's the history of this issue?");
  });

  it('returns project prompts for project entity type', () => {
    const prompts = getSuggestedPrompts('/projects/xyz', 'project');
    expect(prompts).toContain('What are the risks in this project?');
  });

  it('returns program prompts for program entity type', () => {
    const prompts = getSuggestedPrompts('/programs/p1', 'program');
    expect(prompts).toContain('Summarize program status');
  });

  it('returns unknown prompts for unrecognized entity types', () => {
    const prompts = getSuggestedPrompts('/settings', 'unknown');
    expect(prompts).toContain('What should I focus on?');
  });
});

describe('buildChatContext', () => {
  const mockUser = { id: 'user-1', name: 'Dev User', email: 'dev@ship.local' };
  const mockDoc = { type: 'issue' as string | null, id: 'doc-abc', projectId: 'proj-xyz' };

  it('includes route-parsed entity type and ID', () => {
    const ctx = buildChatContext('/issues/abc-123', mockUser, mockDoc);
    expect(ctx.entityType).toBe('issue');
    expect(ctx.entityId).toBe('abc-123');
    expect(ctx.pathname).toBe('/issues/abc-123');
  });

  it('includes user identity fields', () => {
    const ctx = buildChatContext('/docs', mockUser, mockDoc);
    expect(ctx.userId).toBe('user-1');
    expect(ctx.userName).toBe('Dev User');
    expect(ctx.userEmail).toBe('dev@ship.local');
  });

  it('includes document state from React context', () => {
    const ctx = buildChatContext('/docs', mockUser, mockDoc);
    expect(ctx.documentType).toBe('issue');
    expect(ctx.documentId).toBe('doc-abc');
    expect(ctx.projectId).toBe('proj-xyz');
  });

  it('handles null user gracefully', () => {
    const ctx = buildChatContext('/docs', null, mockDoc);
    expect(ctx.userId).toBeUndefined();
    expect(ctx.userName).toBeUndefined();
    expect(ctx.userEmail).toBeUndefined();
  });

  it('handles null document state gracefully', () => {
    const nullDoc = { type: null, id: null, projectId: null };
    const ctx = buildChatContext('/docs', mockUser, nullDoc);
    expect(ctx.documentType).toBeNull();
    expect(ctx.documentId).toBeNull();
    expect(ctx.projectId).toBeNull();
  });

  it('combines route parsing with user and document context', () => {
    const ctx = buildChatContext('/projects/proj-456', mockUser, {
      type: 'project',
      id: 'proj-456',
      projectId: null,
    });
    expect(ctx.entityType).toBe('project');
    expect(ctx.entityId).toBe('proj-456');
    expect(ctx.userName).toBe('Dev User');
    expect(ctx.documentType).toBe('project');
    expect(ctx.documentId).toBe('proj-456');
  });

  it('includes all expected fields in the context shape', () => {
    const ctx = buildChatContext('/issues/abc', mockUser, mockDoc);
    const keys = Object.keys(ctx);
    expect(keys).toContain('pathname');
    expect(keys).toContain('entityType');
    expect(keys).toContain('entityId');
    expect(keys).toContain('userId');
    expect(keys).toContain('userName');
    expect(keys).toContain('userEmail');
    expect(keys).toContain('documentType');
    expect(keys).toContain('documentId');
    expect(keys).toContain('projectId');
  });
});
