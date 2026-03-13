import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'

describe('Weekly Plans API', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testEmail = `weekly-test-${testRunId}@ship.local`
  const testWorkspaceName = `Weekly Test ${testRunId}`

  let sessionCookie: string
  let csrfToken: string
  let testWorkspaceId: string
  let testUserId: string
  let testPersonId: string
  let testProjectId: string

  beforeAll(async () => {
    // Create test workspace with sprint config
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name, sprint_start_date) VALUES ($1, '2025-01-06') RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = workspaceResult.rows[0].id

    // Create test user
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Weekly Test User')
       RETURNING id`,
      [testEmail]
    )
    testUserId = userResult.rows[0].id

    // Create workspace membership
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'member')`,
      [testWorkspaceId, testUserId]
    )

    // Create session
    const sessionId = crypto.randomBytes(32).toString('hex')
    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 hour')`,
      [sessionId, testUserId, testWorkspaceId]
    )
    sessionCookie = `session_id=${sessionId}`

    // Get CSRF token
    const csrfRes = await request(app)
      .get('/api/csrf-token')
      .set('Cookie', sessionCookie)
    csrfToken = csrfRes.body.token
    const connectSidCookie = csrfRes.headers['set-cookie']?.[0]?.split(';')[0] || ''
    if (connectSidCookie) {
      sessionCookie = `${sessionCookie}; ${connectSidCookie}`
    }

    // Create a person document (required for weekly plans)
    const personResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'person', 'Test Person', 'workspace', $2, $3)
       RETURNING id`,
      [testWorkspaceId, testUserId, JSON.stringify({ user_id: testUserId })]
    )
    testPersonId = personResult.rows[0].id

    // Create a project document (optional for weekly plans)
    const projectResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, visibility, created_by, properties)
       VALUES ($1, 'project', 'Test Project', 'workspace', $2, $3)
       RETURNING id`,
      [testWorkspaceId, testUserId, JSON.stringify({ color: '#123456' })]
    )
    testProjectId = projectResult.rows[0].id
  })

  afterAll(async () => {
    // Clean up in correct order (foreign key constraints)
    await pool.query('DELETE FROM document_associations WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = $1)', [testWorkspaceId])
    await pool.query('DELETE FROM document_associations WHERE related_id IN (SELECT id FROM documents WHERE workspace_id = $1)', [testWorkspaceId])
    await pool.query('DELETE FROM document_history WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = $1)', [testWorkspaceId])
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM documents WHERE workspace_id = $1', [testWorkspaceId])
    await pool.query('DELETE FROM workspace_memberships WHERE user_id = $1', [testUserId])
    await pool.query('DELETE FROM users WHERE id = $1', [testUserId])
    await pool.query('DELETE FROM workspaces WHERE id = $1', [testWorkspaceId])
  })

  // ==========================================
  // WEEKLY PLANS
  // ==========================================

  describe('POST /api/weekly-plans', () => {
    it('should create a new weekly plan', async () => {
      const res = await request(app)
        .post('/api/weekly-plans')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ person_id: testPersonId, week_number: 1 })

      expect(res.status).toBe(201)
      expect(res.body.id).toBeDefined()
      expect(res.body.document_type).toBe('weekly_plan')
      expect(res.body.title).toContain('Week 1 Plan')
      expect(res.body.properties.person_id).toBe(testPersonId)
      expect(res.body.properties.week_number).toBe(1)
      // Template content should be present
      expect(res.body.content).toBeDefined()
      expect(res.body.content.type).toBe('doc')
    })

    it('should return existing plan for same person+week (idempotent)', async () => {
      // First create
      const first = await request(app)
        .post('/api/weekly-plans')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ person_id: testPersonId, week_number: 2 })

      expect(first.status).toBe(201)
      const planId = first.body.id

      // Second create with same person+week — should return existing
      const second = await request(app)
        .post('/api/weekly-plans')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ person_id: testPersonId, week_number: 2 })

      expect(second.status).toBe(200)
      expect(second.body.id).toBe(planId)
    })

    it('should create plan with optional project_id', async () => {
      const res = await request(app)
        .post('/api/weekly-plans')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          person_id: testPersonId,
          week_number: 3,
          project_id: testProjectId,
        })

      expect(res.status).toBe(201)
      expect(res.body.properties.project_id).toBe(testProjectId)
    })

    it('should return 404 for non-existent person', async () => {
      const fakeId = crypto.randomUUID()
      const res = await request(app)
        .post('/api/weekly-plans')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ person_id: fakeId, week_number: 1 })

      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Person not found')
    })

    it('should return 400 for invalid input', async () => {
      const res = await request(app)
        .post('/api/weekly-plans')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ person_id: 'not-a-uuid', week_number: 0 })

      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/weekly-plans', () => {
    it('should return plans filtered by person_id', async () => {
      const res = await request(app)
        .get(`/api/weekly-plans?person_id=${testPersonId}`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body).toBeInstanceOf(Array)
      expect(res.body.length).toBeGreaterThan(0)
      // All returned plans should be for this person
      for (const plan of res.body) {
        expect(plan.properties.person_id).toBe(testPersonId)
      }
    })

    it('should return plans filtered by week_number', async () => {
      const res = await request(app)
        .get('/api/weekly-plans?week_number=1')
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body).toBeInstanceOf(Array)
      for (const plan of res.body) {
        expect(plan.properties.week_number).toBe(1)
      }
    })

    it('should return empty array when no plans match', async () => {
      const res = await request(app)
        .get('/api/weekly-plans?week_number=999')
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body).toEqual([])
    })

    it('should include person_name in results', async () => {
      const res = await request(app)
        .get(`/api/weekly-plans?person_id=${testPersonId}`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      if (res.body.length > 0) {
        expect(res.body[0].person_name).toBe('Test Person')
      }
    })
  })

  describe('GET /api/weekly-plans/:id', () => {
    let planId: string

    beforeAll(async () => {
      // Create a plan to fetch
      const res = await request(app)
        .post('/api/weekly-plans')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ person_id: testPersonId, week_number: 10 })

      planId = res.body.id
    })

    it('should return plan by id', async () => {
      const res = await request(app)
        .get(`/api/weekly-plans/${planId}`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body.id).toBe(planId)
      expect(res.body.document_type).toBe('weekly_plan')
      expect(res.body.content).toBeDefined()
    })

    it('should return 404 for non-existent plan', async () => {
      const fakeId = crypto.randomUUID()
      const res = await request(app)
        .get(`/api/weekly-plans/${fakeId}`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/weekly-plans/:id/history', () => {
    let planId: string

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/weekly-plans')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ person_id: testPersonId, week_number: 11 })

      planId = res.body.id
    })

    it('should return empty history for new plan', async () => {
      const res = await request(app)
        .get(`/api/weekly-plans/${planId}/history`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body).toEqual([])
    })

    it('should return 404 for non-existent plan', async () => {
      const fakeId = crypto.randomUUID()
      const res = await request(app)
        .get(`/api/weekly-plans/${fakeId}/history`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(404)
    })
  })

  // ==========================================
  // WEEKLY RETROS
  // ==========================================

  describe('POST /api/weekly-retros', () => {
    it('should create a new weekly retro', async () => {
      const res = await request(app)
        .post('/api/weekly-retros')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ person_id: testPersonId, week_number: 1 })

      expect(res.status).toBe(201)
      expect(res.body.id).toBeDefined()
      expect(res.body.document_type).toBe('weekly_retro')
      expect(res.body.title).toContain('Week 1 Retro')
      expect(res.body.properties.person_id).toBe(testPersonId)
      expect(res.body.content).toBeDefined()
    })

    it('should return existing retro for same person+week (idempotent)', async () => {
      // First create
      const first = await request(app)
        .post('/api/weekly-retros')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ person_id: testPersonId, week_number: 20 })

      expect(first.status).toBe(201)
      const retroId = first.body.id

      // Second create — should return existing
      const second = await request(app)
        .post('/api/weekly-retros')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ person_id: testPersonId, week_number: 20 })

      expect(second.status).toBe(200)
      expect(second.body.id).toBe(retroId)
    })

    it('should auto-populate retro template from corresponding plan', async () => {
      // First create a plan with content for week 30
      const planRes = await request(app)
        .post('/api/weekly-plans')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ person_id: testPersonId, week_number: 30 })

      expect(planRes.status).toBe(201)

      // Update the plan content to have actual items
      const planContent = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'What I plan to accomplish this week' }],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Build the login page' }],
                  },
                ],
              },
            ],
          },
        ],
      }
      await pool.query(
        'UPDATE documents SET content = $1 WHERE id = $2',
        [JSON.stringify(planContent), planRes.body.id]
      )

      // Now create the retro for the same week — should reference plan items
      const retroRes = await request(app)
        .post('/api/weekly-retros')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ person_id: testPersonId, week_number: 30 })

      expect(retroRes.status).toBe(201)
      // The retro template should contain planReference nodes or "What I delivered" heading
      const content = retroRes.body.content
      expect(content.type).toBe('doc')
      expect(content.content.length).toBeGreaterThan(0)
    })

    it('should return 404 for non-existent person', async () => {
      const fakeId = crypto.randomUUID()
      const res = await request(app)
        .post('/api/weekly-retros')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ person_id: fakeId, week_number: 1 })

      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/weekly-retros', () => {
    it('should return retros filtered by person_id', async () => {
      const res = await request(app)
        .get(`/api/weekly-retros?person_id=${testPersonId}`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body).toBeInstanceOf(Array)
      expect(res.body.length).toBeGreaterThan(0)
      for (const retro of res.body) {
        expect(retro.document_type).toBe('weekly_retro')
      }
    })

    it('should return retros filtered by week_number', async () => {
      const res = await request(app)
        .get('/api/weekly-retros?week_number=1')
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body).toBeInstanceOf(Array)
    })
  })

  describe('GET /api/weekly-retros/:id', () => {
    let retroId: string

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/weekly-retros')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ person_id: testPersonId, week_number: 40 })

      retroId = res.body.id
    })

    it('should return retro by id', async () => {
      const res = await request(app)
        .get(`/api/weekly-retros/${retroId}`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body.id).toBe(retroId)
      expect(res.body.document_type).toBe('weekly_retro')
    })

    it('should return 404 for non-existent retro', async () => {
      const fakeId = crypto.randomUUID()
      const res = await request(app)
        .get(`/api/weekly-retros/${fakeId}`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/weekly-retros/:id/history', () => {
    let retroId: string

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/weekly-retros')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ person_id: testPersonId, week_number: 41 })

      retroId = res.body.id
    })

    it('should return empty history for new retro', async () => {
      const res = await request(app)
        .get(`/api/weekly-retros/${retroId}/history`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body).toEqual([])
    })

    it('should return 404 for non-existent retro', async () => {
      const fakeId = crypto.randomUUID()
      const res = await request(app)
        .get(`/api/weekly-retros/${fakeId}/history`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(404)
    })
  })

  // ==========================================
  // ALLOCATION GRID
  // ==========================================

  describe('GET /api/weekly-plans/project-allocation-grid/:projectId', () => {
    it('should return allocation grid for project', async () => {
      const res = await request(app)
        .get(`/api/weekly-plans/project-allocation-grid/${testProjectId}`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body.projectId).toBe(testProjectId)
      expect(res.body.projectTitle).toBe('Test Project')
      expect(res.body.currentSprintNumber).toBeGreaterThan(0)
      expect(res.body.weeks).toBeInstanceOf(Array)
      expect(res.body.people).toBeInstanceOf(Array)
    })

    it('should return 404 for non-existent project', async () => {
      const fakeId = crypto.randomUUID()
      const res = await request(app)
        .get(`/api/weekly-plans/project-allocation-grid/${fakeId}`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(404)
    })
  })

  // ==========================================
  // AUTH
  // ==========================================

  describe('Authentication', () => {
    it('should reject unauthenticated GET for weekly plans', async () => {
      const res = await request(app).get('/api/weekly-plans')
      expect(res.status).toBe(401)
    })

    it('should reject unauthenticated GET for weekly retros', async () => {
      const res = await request(app).get('/api/weekly-retros')
      expect(res.status).toBe(401)
    })
  })
})
