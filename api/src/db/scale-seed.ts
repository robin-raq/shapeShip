/**
 * Scale seed — adds additional data on top of the base seed to reach:
 *   500+ documents, 100+ issues, 20+ users, 10+ sprints
 *
 * Run: cd api && npx tsx src/db/scale-seed.ts
 */
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '../../.env.local') });
config({ path: join(__dirname, '../../.env') });

async function createAssociation(
  pool: pg.Pool,
  documentId: string,
  relatedId: string,
  relationshipType: 'program' | 'project' | 'sprint',
): Promise<void> {
  await pool.query(
    `INSERT INTO document_associations (document_id, related_id, relationship_type, metadata)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (document_id, related_id, relationship_type) DO NOTHING`,
    [documentId, relatedId, relationshipType, JSON.stringify({ created_via: 'scale-seed' })]
  );
}

async function scaleSeed() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  console.log('📈 Starting scale seed...');

  try {
    // Get workspace
    const wsResult = await pool.query(`SELECT id, sprint_start_date FROM workspaces LIMIT 1`);
    if (!wsResult.rows[0]) throw new Error('No workspace found — run pnpm db:seed first');
    const workspaceId = wsResult.rows[0].id;
    const sprintStartDate = new Date(wsResult.rows[0].sprint_start_date);

    // Current sprint number
    const now = new Date();
    const diffMs = now.getTime() - sprintStartDate.getTime();
    const currentSprintNumber = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;

    // Get existing data
    const existingUsers = await pool.query(`SELECT id, email FROM users`);
    const existingPrograms = await pool.query(
      `SELECT id, title, properties FROM documents WHERE workspace_id = $1 AND document_type = 'program' AND deleted_at IS NULL`,
      [workspaceId]
    );
    const existingProjects = await pool.query(
      `SELECT id, title FROM documents WHERE workspace_id = $1 AND document_type = 'project' AND deleted_at IS NULL`,
      [workspaceId]
    );
    const existingSprints = await pool.query(
      `SELECT id, title, properties FROM documents WHERE workspace_id = $1 AND document_type = 'sprint' AND deleted_at IS NULL`,
      [workspaceId]
    );
    const existingDocs = await pool.query(`SELECT count(*)::int as cnt FROM documents WHERE workspace_id = $1`, [workspaceId]);

    console.log(`   Current counts: ${existingDocs.rows[0].cnt} documents, ${existingUsers.rows.length} users, ${existingPrograms.rows.length} programs, ${existingSprints.rows.length} sprints`);

    const passwordHash = await bcrypt.hash('admin123', 10);

    // ── 1. Add users to reach 25 ──
    const additionalUsers: { email: string; name: string }[] = [
      { email: 'kate.wilson@ship.local', name: 'Kate Wilson' },
      { email: 'liam.jones@ship.local', name: 'Liam Jones' },
      { email: 'maya.clark@ship.local', name: 'Maya Clark' },
      { email: 'noah.wright@ship.local', name: 'Noah Wright' },
      { email: 'olivia.hall@ship.local', name: 'Olivia Hall' },
      { email: 'peter.young@ship.local', name: 'Peter Young' },
      { email: 'quinn.adams@ship.local', name: 'Quinn Adams' },
      { email: 'rachel.scott@ship.local', name: 'Rachel Scott' },
      { email: 'sam.turner@ship.local', name: 'Sam Turner' },
      { email: 'tina.baker@ship.local', name: 'Tina Baker' },
      { email: 'uma.ross@ship.local', name: 'Uma Ross' },
      { email: 'victor.reed@ship.local', name: 'Victor Reed' },
      { email: 'wendy.cox@ship.local', name: 'Wendy Cox' },
      { email: 'xavier.diaz@ship.local', name: 'Xavier Diaz' },
    ];

    const newUserIds: string[] = [];
    for (const user of additionalUsers) {
      const existing = await pool.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [user.email]);
      if (existing.rows[0]) {
        newUserIds.push(existing.rows[0].id);
        continue;
      }
      const result = await pool.query(
        `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id`,
        [user.email, passwordHash, user.name]
      );
      const userId = result.rows[0].id;
      newUserIds.push(userId);

      // Add workspace membership
      await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role)
         VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`,
        [workspaceId, userId]
      );

      // Create person document
      const devUser = existingUsers.rows[0];
      await pool.query(
        `INSERT INTO documents (workspace_id, title, document_type, created_by, properties, visibility)
         VALUES ($1, $2, 'person', $3, $4, 'workspace')
         ON CONFLICT DO NOTHING`,
        [workspaceId, user.name, devUser.id, JSON.stringify({
          user_id: userId,
          email: user.email,
          reports_to: devUser.id,
          capacity_hours: 40,
          skills: ['development'],
        })]
      );
    }
    const allUserIds = [...existingUsers.rows.map((r: { id: string }) => r.id), ...newUserIds];
    console.log(`✅ Users: ${allUserIds.length} total (added ${newUserIds.length})`);

    // ── 2. Add sprints to reach 14+ per program ──
    const programIds = existingPrograms.rows.map((r: { id: string }) => r.id);
    const projectIds = existingProjects.rows.map((r: { id: string }) => r.id);
    const personDocs = await pool.query(
      `SELECT id, properties->>'user_id' as user_id FROM documents WHERE workspace_id = $1 AND document_type = 'person' AND deleted_at IS NULL`,
      [workspaceId]
    );
    const personDocIds = personDocs.rows.map((r: { id: string }) => r.id);

    let sprintsAdded = 0;
    const allSprintIds: string[] = existingSprints.rows.map((r: { id: string }) => r.id);

    for (const program of existingPrograms.rows) {
      const prefix = (program.properties as { prefix?: string })?.prefix || 'PRG';
      // Get existing sprints for this program
      const progSprints = await pool.query(
        `SELECT d.id, d.properties->>'sprint_number' as sn FROM documents d
         JOIN document_associations da ON d.id = da.document_id
         WHERE da.related_id = $1 AND da.relationship_type = 'program'
         AND d.document_type = 'sprint' AND d.deleted_at IS NULL`,
        [program.id]
      );
      const existingSprintNums = new Set(progSprints.rows.map((r: { sn: string }) => parseInt(r.sn)));

      // Add sprints from -6 to +4 relative to current (wider range)
      for (let offset = -6; offset <= 4; offset++) {
        const sprintNum = currentSprintNumber + offset;
        if (sprintNum < 1 || existingSprintNums.has(sprintNum)) continue;

        const status = offset < 0 ? 'completed' : offset === 0 ? 'active' : null;
        const confidence = offset < -2 ? 95 : offset < 0 ? 85 : offset === 0 ? 75 : offset === 1 ? 60 : 40;
        const ownerIdx = (sprintNum + programIds.indexOf(program.id)) % allUserIds.length;
        const assigneeCount = 2 + (sprintNum % 3);
        const assigneeIds = personDocIds.slice(ownerIdx, ownerIdx + assigneeCount);

        const result = await pool.query(
          `INSERT INTO documents (workspace_id, title, document_type, created_by, properties, visibility)
           VALUES ($1, $2, 'sprint', $3, $4, 'workspace') RETURNING id`,
          [workspaceId, `${prefix} Sprint ${sprintNum}`, allUserIds[0], JSON.stringify({
            sprint_number: sprintNum,
            owner_id: allUserIds[ownerIdx],
            assignee_ids: assigneeIds,
            plan: `Sprint ${sprintNum} plan for ${prefix}`,
            success_criteria: `Deliver key features for sprint ${sprintNum}`,
            confidence,
            ...(status ? { status } : {}),
          })]
        );
        const sprintId = result.rows[0].id;
        allSprintIds.push(sprintId);
        await createAssociation(pool, sprintId, program.id, 'program');

        // Link to a project
        const projIdx = (sprintNum + programIds.indexOf(program.id)) % projectIds.length;
        const projectId = projectIds[projIdx];
        if (projectId) {
          await createAssociation(pool, sprintId, projectId, 'project');
        }

        sprintsAdded++;
      }
    }
    console.log(`✅ Sprints: ${allSprintIds.length} total (added ${sprintsAdded})`);

    // ── 3. Add issues to reach 200+ ──
    const states = ['backlog', 'triage', 'todo', 'in_progress', 'in_review', 'done', 'cancelled'];
    const priorities = ['low', 'medium', 'high'];
    const sources = ['internal', 'external'];

    // Get current max ticket numbers per program
    const maxTickets: Record<string, number> = {};
    for (const program of existingPrograms.rows) {
      const result = await pool.query(
        `SELECT COALESCE(MAX(ticket_number), 0)::int as max_tn FROM documents d
         JOIN document_associations da ON d.id = da.document_id
         WHERE da.related_id = $1 AND da.relationship_type = 'program'
         AND d.document_type = 'issue'`,
        [program.id]
      );
      maxTickets[program.id] = result.rows[0].max_tn;
    }

    const issueNames = [
      'Fix login redirect loop', 'Add pagination to list view', 'Update error messages',
      'Optimize database queries', 'Add loading spinners', 'Fix mobile layout', 'Update API docs',
      'Add search filters', 'Fix date formatting', 'Improve form validation',
      'Add dark mode toggle', 'Fix file upload timeout', 'Add keyboard shortcuts',
      'Optimize image compression', 'Fix notification delivery', 'Add audit logging',
      'Update RBAC permissions', 'Fix CSV export encoding', 'Add drag-and-drop sorting',
      'Improve cache invalidation', 'Fix WebSocket reconnection', 'Add batch operations',
      'Update onboarding flow', 'Fix timezone display', 'Add progress indicators',
      'Optimize bundle splitting', 'Fix session expiration', 'Add data export feature',
      'Update accessibility labels', 'Fix scroll position reset',
    ];

    let issuesAdded = 0;
    const targetIssuesPerProgram = 40;

    for (const program of existingPrograms.rows) {
      const prefix = (program.properties as { prefix?: string })?.prefix || 'PRG';

      // Get sprints for this program
      const progSprintResult = await pool.query(
        `SELECT d.id, d.properties->>'sprint_number' as sn FROM documents d
         JOIN document_associations da ON d.id = da.document_id
         WHERE da.related_id = $1 AND da.relationship_type = 'program'
         AND d.document_type = 'sprint' AND d.deleted_at IS NULL`,
        [program.id]
      );
      const progSprintIds = progSprintResult.rows.map((r: { id: string }) => r.id);

      // Get projects for this program
      const progProjectResult = await pool.query(
        `SELECT d.id FROM documents d
         JOIN document_associations da ON d.id = da.document_id
         WHERE da.related_id = $1 AND da.relationship_type = 'program'
         AND d.document_type = 'project' AND d.deleted_at IS NULL`,
        [program.id]
      );
      const progProjectIds = progProjectResult.rows.map((r: { id: string }) => r.id);

      for (let i = 0; i < targetIssuesPerProgram; i++) {
        const currentTn = (maxTickets[program.id] ?? 0) + 1;
        maxTickets[program.id] = currentTn;
        const tn = currentTn;
        const state = states[i % states.length];
        const priority = priorities[i % priorities.length];
        const assigneeIdx = i % personDocIds.length;
        const nameIdx = i % issueNames.length;
        const estimate = [1, 2, 3, 5, 8, 13][i % 6];

        const result = await pool.query(
          `INSERT INTO documents (workspace_id, title, document_type, created_by, ticket_number, properties, visibility)
           VALUES ($1, $2, 'issue', $3, $4, $5, 'workspace') RETURNING id`,
          [workspaceId, `${prefix}-${tn}: ${issueNames[nameIdx]}`, allUserIds[i % allUserIds.length],
           tn, JSON.stringify({
            state,
            priority,
            assignee_id: personDocIds[assigneeIdx],
            source: sources[i % 2],
            estimate,
          })]
        );
        const issueId = result.rows[0].id;

        await createAssociation(pool, issueId, program.id, 'program');
        if (progProjectIds.length > 0) {
          const projId = progProjectIds[i % progProjectIds.length];
          if (projId) {
            await createAssociation(pool, issueId, projId, 'project');
          }
        }
        if (progSprintIds.length > 0 && state !== 'backlog') {
          const spId = progSprintIds[i % progSprintIds.length];
          if (spId) {
            await createAssociation(pool, issueId, spId, 'sprint');
          }
        }
        issuesAdded++;
      }
    }
    console.log(`✅ Issues: added ${issuesAdded}`);

    // ── 4. Add wiki documents to reach 500+ total ──
    const wikiTopics = [
      'Architecture Overview', 'Deployment Guide', 'Testing Strategy', 'Security Policy',
      'Performance Tuning', 'Monitoring Setup', 'Incident Response', 'Code Review Checklist',
      'Release Process', 'Database Maintenance', 'API Conventions', 'Accessibility Guidelines',
      'Error Handling Patterns', 'Authentication Flow', 'Data Migration Guide', 'Backup Procedures',
      'Load Testing Results', 'Capacity Planning', 'Compliance Requirements', 'Team Onboarding',
    ];

    // Check how many docs we have now
    const currentCount = await pool.query(
      `SELECT count(*)::int as cnt FROM documents WHERE workspace_id = $1`,
      [workspaceId]
    );
    const docsNeeded = Math.max(0, 520 - currentCount.rows[0].cnt);
    let wikisAdded = 0;

    for (let i = 0; i < docsNeeded; i++) {
      const topic = wikiTopics[i % wikiTopics.length];
      const suffix = i >= wikiTopics.length ? ` (Part ${Math.floor(i / wikiTopics.length) + 1})` : '';
      await pool.query(
        `INSERT INTO documents (workspace_id, title, document_type, created_by, visibility)
         VALUES ($1, $2, 'wiki', $3, 'workspace')`,
        [workspaceId, `${topic}${suffix}`, allUserIds[i % allUserIds.length]]
      );
      wikisAdded++;
    }
    console.log(`✅ Wiki docs: added ${wikisAdded}`);

    // ── Final counts ──
    const finalCounts = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM documents WHERE workspace_id = $1) as total_docs,
        (SELECT count(*)::int FROM documents WHERE workspace_id = $1 AND document_type = 'issue' AND deleted_at IS NULL) as issues,
        (SELECT count(*)::int FROM documents WHERE workspace_id = $1 AND document_type = 'sprint' AND deleted_at IS NULL) as sprints,
        (SELECT count(*)::int FROM documents WHERE workspace_id = $1 AND document_type = 'project' AND deleted_at IS NULL) as projects,
        (SELECT count(*)::int FROM documents WHERE workspace_id = $1 AND document_type = 'program' AND deleted_at IS NULL) as programs,
        (SELECT count(*)::int FROM documents WHERE workspace_id = $1 AND document_type = 'wiki' AND deleted_at IS NULL) as wikis,
        (SELECT count(*)::int FROM users) as users,
        (SELECT count(*)::int FROM document_associations) as associations
    `, [workspaceId]);

    const c = finalCounts.rows[0];
    console.log(`\n📊 Final counts:`);
    console.log(`   Documents: ${c.total_docs} (target: 500+)`);
    console.log(`   Issues: ${c.issues} (target: 100+)`);
    console.log(`   Sprints: ${c.sprints} (target: 10+)`);
    console.log(`   Projects: ${c.projects}`);
    console.log(`   Programs: ${c.programs}`);
    console.log(`   Wikis: ${c.wikis}`);
    console.log(`   Users: ${c.users} (target: 20+)`);
    console.log(`   Associations: ${c.associations}`);

    console.log('\n✅ Scale seed complete');
  } finally {
    await pool.end();
  }
}

scaleSeed().catch(err => {
  console.error('Scale seed failed:', err);
  process.exit(1);
});
