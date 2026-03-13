-- AFTER: Sprint list query with 3 CTEs (post-commit 16d5c10)
-- Run: psql ship_dev < api/benchmarks/explain-after.sql
-- Requires: pnpm db:seed (257 documents, 104 issues, 35 sprints)

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
WITH issue_stats AS (
  SELECT ida.related_id as sprint_id,
         COUNT(*) as issue_count,
         COUNT(*) FILTER (WHERE i.properties->>'state' = 'done') as completed_count,
         COUNT(*) FILTER (WHERE i.properties->>'state' IN ('in_progress', 'in_review')) as started_count
  FROM documents i
  JOIN document_associations ida ON ida.document_id = i.id AND ida.relationship_type = 'sprint'
  WHERE i.document_type = 'issue'
  GROUP BY ida.related_id
),
plan_check AS (
  SELECT parent_id as sprint_id, TRUE as has_plan
  FROM documents
  WHERE document_type = 'weekly_plan'
  GROUP BY parent_id
),
retro_info AS (
  SELECT DISTINCT ON (rda.related_id)
         rda.related_id as sprint_id,
         TRUE as has_retro,
         rt.properties->>'outcome' as retro_outcome,
         rt.id as retro_id
  FROM documents rt
  JOIN document_associations rda ON rda.document_id = rt.id AND rda.relationship_type = 'sprint'
  WHERE rt.properties->>'outcome' IS NOT NULL
  ORDER BY rda.related_id, rt.created_at DESC
)
SELECT d.id, d.title, d.properties, prog_da.related_id as program_id,
       p.title as program_name, p.properties->>'prefix' as program_prefix,
       p.properties->>'accountable_id' as program_accountable_id,
       op.properties->>'reports_to' as owner_reports_to,
       w.sprint_start_date as workspace_sprint_start_date,
       u.id as owner_id, u.name as owner_name, u.email as owner_email,
       COALESCE(ist.issue_count, 0) as issue_count,
       COALESCE(ist.completed_count, 0) as completed_count,
       COALESCE(ist.started_count, 0) as started_count,
       COALESCE(pc.has_plan, FALSE) as has_plan,
       COALESCE(ri.has_retro, FALSE) as has_retro,
       ri.retro_outcome,
       ri.retro_id
FROM documents d
LEFT JOIN document_associations prog_da
  ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
LEFT JOIN documents p ON prog_da.related_id = p.id
JOIN workspaces w ON d.workspace_id = w.id
LEFT JOIN users u ON (d.properties->'assignee_ids'->>0)::uuid = u.id
LEFT JOIN documents op ON d.properties->>'owner_id' IS NOT NULL
  AND op.id = (d.properties->>'owner_id')::uuid
  AND op.document_type = 'person' AND op.workspace_id = d.workspace_id
LEFT JOIN issue_stats ist ON ist.sprint_id = d.id
LEFT JOIN plan_check pc ON pc.sprint_id = d.id
LEFT JOIN retro_info ri ON ri.sprint_id = d.id
WHERE d.workspace_id = (SELECT id FROM workspaces LIMIT 1)
  AND d.document_type = 'sprint'
ORDER BY (d.properties->>'sprint_number')::int, p.title;
