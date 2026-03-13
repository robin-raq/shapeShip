import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { createApp } from '../app.js'
import { pool } from '../db/client.js'

describe('Programs API', () => {
  const app = createApp()
  const testRunId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const testEmail = `programs-test-${testRunId}@ship.local`
  const testWorkspaceName = `Programs Test ${testRunId}`

  let sessionCookie: string
  let csrfToken: string
  let testWorkspaceId: string
  let testUserId: string

  beforeAll(async () => {
    // Create test workspace
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name) VALUES ($1) RETURNING id`,
      [testWorkspaceName]
    )
    testWorkspaceId = workspaceResult.rows[0].id

    // Create test user
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, 'test-hash', 'Programs Test User')
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

  describe('POST /api/programs', () => {
    it('should create a program with default values', async () => {
      const res = await request(app)
        .post('/api/programs')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ title: 'Test Program' })

      expect(res.status).toBe(201)
      expect(res.body.id).toBeDefined()
      expect(res.body.name).toBe('Test Program')
      expect(res.body.color).toBe('#6366f1')
      expect(res.body.emoji).toBeNull()
      expect(res.body.issue_count).toBe(0)
      expect(res.body.sprint_count).toBe(0)
    })

    it('should create a program with custom color and emoji', async () => {
      const res = await request(app)
        .post('/api/programs')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ title: 'Styled Program', color: '#ff5733', emoji: '🚀' })

      expect(res.status).toBe(201)
      expect(res.body.color).toBe('#ff5733')
      expect(res.body.emoji).toBe('🚀')
    })

    it('should create a program with RACI fields', async () => {
      const res = await request(app)
        .post('/api/programs')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          title: 'RACI Program',
          owner_id: testUserId,
          accountable_id: testUserId,
          consulted_ids: [testUserId],
          informed_ids: [testUserId],
        })

      expect(res.status).toBe(201)
      expect(res.body.owner_id).toBe(testUserId)
      expect(res.body.accountable_id).toBe(testUserId)
      expect(res.body.consulted_ids).toEqual([testUserId])
      expect(res.body.informed_ids).toEqual([testUserId])
    })

    it('should default title to Untitled when not provided', async () => {
      const res = await request(app)
        .post('/api/programs')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({})

      expect(res.status).toBe(201)
      expect(res.body.name).toBe('Untitled')
    })

    it('should reject invalid color format', async () => {
      const res = await request(app)
        .post('/api/programs')
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ title: 'Bad Color', color: 'not-a-color' })

      expect(res.status).toBe(400)
      expect(res.body.error).toBe('Invalid input')
    })

    it('should reject unauthenticated request', async () => {
      const res = await request(app)
        .post('/api/programs')
        .send({ title: 'No Auth' })

      // CSRF middleware runs before auth, so unauthenticated mutations get 403
      expect(res.status).toBe(403)
    })
  })

  describe('GET /api/programs', () => {
    let listProgramId: string

    beforeAll(async () => {
      const result = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, properties, created_by, visibility)
         VALUES ($1, 'program', 'List Test Program', $2, $3, 'workspace')
         RETURNING id`,
        [testWorkspaceId, JSON.stringify({ color: '#123456' }), testUserId]
      )
      listProgramId = result.rows[0].id
    })

    it('should return list of programs', async () => {
      const res = await request(app)
        .get('/api/programs')
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body).toBeInstanceOf(Array)
      const found = res.body.find((p: { id: string }) => p.id === listProgramId)
      expect(found).toBeDefined()
      expect(found.name).toBe('List Test Program')
    })

    it('should exclude archived programs by default', async () => {
      const archivedResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, properties, created_by, visibility, archived_at)
         VALUES ($1, 'program', 'Archived Program', $2, $3, 'workspace', now())
         RETURNING id`,
        [testWorkspaceId, JSON.stringify({ color: '#000000' }), testUserId]
      )
      const archivedId = archivedResult.rows[0].id

      const res = await request(app)
        .get('/api/programs')
        .set('Cookie', sessionCookie)

      const found = res.body.find((p: { id: string }) => p.id === archivedId)
      expect(found).toBeUndefined()
    })

    it('should include archived programs when requested', async () => {
      const res = await request(app)
        .get('/api/programs?archived=true')
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      const hasArchived = res.body.some((p: { archived_at: string | null }) => p.archived_at !== null)
      expect(hasArchived).toBe(true)
    })

    it('should reject unauthenticated request', async () => {
      const res = await request(app).get('/api/programs')
      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/programs/:id', () => {
    let singleProgramId: string

    beforeAll(async () => {
      const result = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, properties, created_by, visibility)
         VALUES ($1, 'program', 'Single Program', $2, $3, 'workspace')
         RETURNING id`,
        [testWorkspaceId, JSON.stringify({ color: '#abcdef', emoji: '🎯' }), testUserId]
      )
      singleProgramId = result.rows[0].id
    })

    it('should return program by id', async () => {
      const res = await request(app)
        .get(`/api/programs/${singleProgramId}`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body.id).toBe(singleProgramId)
      expect(res.body.name).toBe('Single Program')
      expect(res.body.color).toBe('#abcdef')
      expect(res.body.emoji).toBe('🎯')
    })

    it('should return 404 for non-existent program', async () => {
      const fakeId = crypto.randomUUID()
      const res = await request(app)
        .get(`/api/programs/${fakeId}`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /api/programs/:id', () => {
    let updateProgramId: string

    beforeAll(async () => {
      const result = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, properties, created_by, visibility)
         VALUES ($1, 'program', 'Program to Update', $2, $3, 'workspace')
         RETURNING id`,
        [testWorkspaceId, JSON.stringify({ color: '#111111' }), testUserId]
      )
      updateProgramId = result.rows[0].id
    })

    it('should update program title', async () => {
      const res = await request(app)
        .patch(`/api/programs/${updateProgramId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ title: 'Updated Title' })

      expect(res.status).toBe(200)
      expect(res.body.name).toBe('Updated Title')
    })

    it('should update program color', async () => {
      const res = await request(app)
        .patch(`/api/programs/${updateProgramId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ color: '#ff0000' })

      expect(res.status).toBe(200)
      expect(res.body.color).toBe('#ff0000')
    })

    it('should update RACI fields', async () => {
      const res = await request(app)
        .patch(`/api/programs/${updateProgramId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({
          owner_id: testUserId,
          accountable_id: testUserId,
        })

      expect(res.status).toBe(200)
      expect(res.body.owner_id).toBe(testUserId)
      expect(res.body.accountable_id).toBe(testUserId)
    })

    it('should archive a program', async () => {
      const archiveTime = new Date().toISOString()
      const res = await request(app)
        .patch(`/api/programs/${updateProgramId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ archived_at: archiveTime })

      expect(res.status).toBe(200)
      expect(res.body.archived_at).toBeDefined()

      // Unarchive for subsequent tests
      await request(app)
        .patch(`/api/programs/${updateProgramId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ archived_at: null })
    })

    it('should return 400 with no fields to update', async () => {
      const res = await request(app)
        .patch(`/api/programs/${updateProgramId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({})

      expect(res.status).toBe(400)
    })

    it('should return 404 for non-existent program', async () => {
      const fakeId = crypto.randomUUID()
      const res = await request(app)
        .patch(`/api/programs/${fakeId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)
        .send({ title: 'Should Fail' })

      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /api/programs/:id', () => {
    it('should delete a program', async () => {
      // Create program to delete
      const result = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, properties, created_by, visibility)
         VALUES ($1, 'program', 'Program to Delete', $2, $3, 'workspace')
         RETURNING id`,
        [testWorkspaceId, JSON.stringify({ color: '#999999' }), testUserId]
      )
      const programId = result.rows[0].id

      const res = await request(app)
        .delete(`/api/programs/${programId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(res.status).toBe(204)

      // Verify it's gone
      const getRes = await request(app)
        .get(`/api/programs/${programId}`)
        .set('Cookie', sessionCookie)

      expect(getRes.status).toBe(404)
    })

    it('should return 404 for non-existent program', async () => {
      const fakeId = crypto.randomUUID()
      const res = await request(app)
        .delete(`/api/programs/${fakeId}`)
        .set('Cookie', sessionCookie)
        .set('x-csrf-token', csrfToken)

      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/programs/:id/issues', () => {
    let programId: string
    let issueId: string

    beforeAll(async () => {
      // Create program
      const programResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, properties, created_by, visibility)
         VALUES ($1, 'program', 'Issues Program', $2, $3, 'workspace')
         RETURNING id`,
        [testWorkspaceId, JSON.stringify({ color: '#222222' }), testUserId]
      )
      programId = programResult.rows[0].id

      // Create issue associated with this program
      const issueResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, properties, created_by, visibility)
         VALUES ($1, 'issue', 'Program Issue', $2, $3, 'workspace')
         RETURNING id`,
        [testWorkspaceId, JSON.stringify({ state: 'backlog', priority: 'high' }), testUserId]
      )
      issueId = issueResult.rows[0].id

      // Create program association
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [issueId, programId]
      )
    })

    it('should return issues for program', async () => {
      const res = await request(app)
        .get(`/api/programs/${programId}/issues`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body).toBeInstanceOf(Array)
      expect(res.body.length).toBe(1)
      expect(res.body[0].id).toBe(issueId)
      expect(res.body[0].title).toBe('Program Issue')
      expect(res.body[0].state).toBe('backlog')
      expect(res.body[0].priority).toBe('high')
    })

    it('should return 404 for non-existent program', async () => {
      const fakeId = crypto.randomUUID()
      const res = await request(app)
        .get(`/api/programs/${fakeId}/issues`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/programs/:id/projects', () => {
    let programId: string
    let projectId: string

    beforeAll(async () => {
      // Create program
      const programResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, properties, created_by, visibility)
         VALUES ($1, 'program', 'Projects Program', $2, $3, 'workspace')
         RETURNING id`,
        [testWorkspaceId, JSON.stringify({ color: '#333333' }), testUserId]
      )
      programId = programResult.rows[0].id

      // Create project associated with this program
      const projectResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, properties, created_by, visibility)
         VALUES ($1, 'project', 'Program Project', $2, $3, 'workspace')
         RETURNING id`,
        [testWorkspaceId, JSON.stringify({ color: '#444444', impact: 4, confidence: 3, ease: 5 }), testUserId]
      )
      projectId = projectResult.rows[0].id

      // Create program association
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [projectId, programId]
      )
    })

    it('should return projects for program', async () => {
      const res = await request(app)
        .get(`/api/programs/${programId}/projects`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body).toBeInstanceOf(Array)
      expect(res.body.length).toBe(1)
      expect(res.body[0].id).toBe(projectId)
      expect(res.body[0].title).toBe('Program Project')
      expect(res.body[0].ice_score).toBe(60) // 4 * 3 * 5
    })
  })

  describe('GET /api/programs/:id/sprints', () => {
    let programId: string
    let sprintId: string

    beforeAll(async () => {
      // Ensure workspace has sprint_start_date
      await pool.query(
        `UPDATE workspaces SET sprint_start_date = '2025-01-06' WHERE id = $1`,
        [testWorkspaceId]
      )

      // Create program
      const programResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, properties, created_by, visibility)
         VALUES ($1, 'program', 'Sprints Program', $2, $3, 'workspace')
         RETURNING id`,
        [testWorkspaceId, JSON.stringify({ color: '#555555' }), testUserId]
      )
      programId = programResult.rows[0].id

      // Create sprint associated with this program
      const sprintResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, properties, created_by, visibility)
         VALUES ($1, 'sprint', 'Week 1', $2, $3, 'workspace')
         RETURNING id`,
        [testWorkspaceId, JSON.stringify({ sprint_number: 1, status: 'active' }), testUserId]
      )
      sprintId = sprintResult.rows[0].id

      // Create program association
      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [sprintId, programId]
      )
    })

    it('should return sprints for program with workspace config', async () => {
      const res = await request(app)
        .get(`/api/programs/${programId}/sprints`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(200)
      expect(res.body.workspace_sprint_start_date).toBeDefined()
      expect(res.body.weeks).toBeInstanceOf(Array)
      expect(res.body.weeks.length).toBe(1)
      expect(res.body.weeks[0].id).toBe(sprintId)
      expect(res.body.weeks[0].name).toBe('Week 1')
      expect(res.body.weeks[0].sprint_number).toBe(1)
      expect(res.body.weeks[0].status).toBe('active')
    })

    it('should return 404 for non-existent program', async () => {
      const fakeId = crypto.randomUUID()
      const res = await request(app)
        .get(`/api/programs/${fakeId}/sprints`)
        .set('Cookie', sessionCookie)

      expect(res.status).toBe(404)
    })
  })

  describe('Merge operations', () => {
    let sourceProgramId: string
    let targetProgramId: string
    let mergeIssueId: string

    beforeAll(async () => {
      // Create source program
      const sourceResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, properties, created_by, visibility)
         VALUES ($1, 'program', 'Source Program', $2, $3, 'workspace')
         RETURNING id`,
        [testWorkspaceId, JSON.stringify({ color: '#666666' }), testUserId]
      )
      sourceProgramId = sourceResult.rows[0].id

      // Create target program
      const targetResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, properties, created_by, visibility)
         VALUES ($1, 'program', 'Target Program', $2, $3, 'workspace')
         RETURNING id`,
        [testWorkspaceId, JSON.stringify({ color: '#777777' }), testUserId]
      )
      targetProgramId = targetResult.rows[0].id

      // Create issue in source program
      const issueResult = await pool.query(
        `INSERT INTO documents (workspace_id, document_type, title, properties, created_by, visibility)
         VALUES ($1, 'issue', 'Merge Issue', $2, $3, 'workspace')
         RETURNING id`,
        [testWorkspaceId, JSON.stringify({ state: 'backlog', priority: 'medium' }), testUserId]
      )
      mergeIssueId = issueResult.rows[0].id

      await pool.query(
        `INSERT INTO document_associations (document_id, related_id, relationship_type)
         VALUES ($1, $2, 'program')`,
        [mergeIssueId, sourceProgramId]
      )
    })

    describe('GET /api/programs/:id/merge-preview', () => {
      it('should return merge preview with counts', async () => {
        const res = await request(app)
          .get(`/api/programs/${sourceProgramId}/merge-preview?target_id=${targetProgramId}`)
          .set('Cookie', sessionCookie)

        expect(res.status).toBe(200)
        expect(res.body.source.id).toBe(sourceProgramId)
        expect(res.body.target.id).toBe(targetProgramId)
        expect(res.body.counts).toBeDefined()
        expect(res.body.counts.issues).toBe(1)
      })

      it('should reject merge into itself', async () => {
        const res = await request(app)
          .get(`/api/programs/${sourceProgramId}/merge-preview?target_id=${sourceProgramId}`)
          .set('Cookie', sessionCookie)

        expect(res.status).toBe(400)
      })

      it('should require target_id', async () => {
        const res = await request(app)
          .get(`/api/programs/${sourceProgramId}/merge-preview`)
          .set('Cookie', sessionCookie)

        expect(res.status).toBe(400)
      })
    })

    describe('POST /api/programs/:id/merge', () => {
      it('should reject merge with wrong confirmation name', async () => {
        const res = await request(app)
          .post(`/api/programs/${sourceProgramId}/merge`)
          .set('Cookie', sessionCookie)
          .set('x-csrf-token', csrfToken)
          .send({ target_id: targetProgramId, confirm_name: 'Wrong Name' })

        expect(res.status).toBe(409)
      })

      it('should merge source into target', async () => {
        const res = await request(app)
          .post(`/api/programs/${sourceProgramId}/merge`)
          .set('Cookie', sessionCookie)
          .set('x-csrf-token', csrfToken)
          .send({ target_id: targetProgramId, confirm_name: 'Source Program' })

        expect(res.status).toBe(200)
        expect(res.body.id).toBe(targetProgramId)

        // Source should be archived (GET /:id still returns archived programs)
        const sourceRes = await request(app)
          .get(`/api/programs/${sourceProgramId}`)
          .set('Cookie', sessionCookie)

        expect(sourceRes.status).toBe(200)
        expect(sourceRes.body.archived_at).not.toBeNull()

        // Issue should now be in target program
        const targetIssuesRes = await request(app)
          .get(`/api/programs/${targetProgramId}/issues`)
          .set('Cookie', sessionCookie)

        const movedIssue = targetIssuesRes.body.find((i: { id: string }) => i.id === mergeIssueId)
        expect(movedIssue).toBeDefined()
      })
    })
  })
})
