import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

/**
 * Tests for session store configuration.
 *
 * express-session is used only for CSRF token storage (via csrf-sync).
 * Auth sessions use a custom PostgreSQL sessions table.
 *
 * In production/dev, CSRF tokens are stored in PostgreSQL via connect-pg-simple
 * (table: http_sessions). In test mode, the default MemoryStore is used.
 *
 * These tests verify that the CSRF token flow works correctly regardless
 * of which store is backing express-session.
 */
describe('Session Store — CSRF Token Flow', () => {
  const app = createApp('http://localhost:5173');

  it('returns a CSRF token from /api/csrf-token', async () => {
    const res = await request(app).get('/api/csrf-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBeGreaterThan(0);
  });

  it('sets a session cookie when generating a CSRF token', async () => {
    const res = await request(app).get('/api/csrf-token');

    // express-session sets a connect.sid cookie to track the session
    const cookies = res.headers['set-cookie'] as string[] | undefined;
    expect(cookies).toBeDefined();

    const hasSessionCookie = cookies!.some((c) => c.startsWith('connect.sid='));
    expect(hasSessionCookie).toBe(true);
  });

  it('reuses the same session across requests with the session cookie', async () => {
    // First request: get token + session cookie
    const firstRes = await request(app).get('/api/csrf-token');
    const token1 = firstRes.body.token;
    const cookies = firstRes.headers['set-cookie'] as string[] | undefined;
    expect(cookies).toBeDefined();
    const sessionCookie = cookies!.find((c) => c.startsWith('connect.sid='));

    // Second request: send same session cookie, should get same token
    const secondRes = await request(app)
      .get('/api/csrf-token')
      .set('Cookie', sessionCookie!);
    const token2 = secondRes.body.token;

    // Same session should produce the same CSRF token
    expect(token2).toBe(token1);
  });
});
