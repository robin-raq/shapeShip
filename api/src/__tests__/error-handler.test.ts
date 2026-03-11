import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

/**
 * Tests for global Express error handling middleware.
 *
 * These verify that the API returns consistent JSON error responses
 * instead of HTML pages for all error conditions.
 *
 * Risk mitigated: Inconsistent error formats break API clients;
 * malformed JSON currently returns an HTML error page.
 */
describe('Global Error Handler Middleware', () => {
  let app: express.Express;

  beforeEach(async () => {
    // Import createApp fresh — once the error handler is added,
    // it should be registered in createApp()
    const { createApp } = await import('../app.js');
    app = createApp('http://localhost:5173');
  });

  it('returns JSON (not HTML) for malformed JSON body', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set('Content-Type', 'application/json')
      .send('{invalid json}');

    // Should return 400 with JSON error, not an HTML page
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toHaveProperty('error');
  });

  it('returns consistent error format with code and message', async () => {
    const res = await request(app)
      .post('/api/documents')
      .set('Content-Type', 'application/json')
      .send('{bad}');

    expect(res.body.error).toHaveProperty('code');
    expect(res.body.error).toHaveProperty('message');
    expect(typeof res.body.error.code).toBe('string');
    expect(typeof res.body.error.message).toBe('string');
  });

  it('returns 404 JSON for unknown API routes', async () => {
    const res = await request(app)
      .get('/api/nonexistent-route');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toHaveProperty('error');
  });

  it('does not leak stack traces in production', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const res = await request(app)
      .post('/api/documents')
      .set('Content-Type', 'application/json')
      .send('{bad}');

    expect(res.body).not.toHaveProperty('stack');
    expect(JSON.stringify(res.body)).not.toContain('at ');

    process.env.NODE_ENV = originalEnv;
  });
});
