-- BEFORE: Sprint list query with 7 correlated subqueries (pre-commit 16d5c10)
-- Run: psql ship_dev < api/benchmarks/explain-before.sql
-- Requires: pnpm db:seed (257 documents, 104 issues, 35 sprints)

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT d.id, d.title, d.properties, prog_da.related_id as program_id,
       p.title as program_name, p.properties->>'prefix' as program_prefix,
       p.properties->>'accountable_id' as program_accountable_id,
       (SELECT op.properties->>'reports_to' FROM documents op
        WHERE d.properties->>'owner_id' IS NOT NULL
          AND op.id = (d.properties->>'owner_id')::uuid
          AND op.document_type = 'person'
          AND op.workspace_id = d.workspace_id) as owner_reports_to,
       u.id as owner_id, u.name as owner_name, u.email as owner_email,
       -- SubQuery 1: issue_count (re-scans issues + associations per row)
       (SELECT COUNT(*) FROM documents i
        JOIN document_associations ida ON ida.document_id = i.id
          AND ida.related_id = d.id AND ida.relationship_type = 'sprint'
        WHERE i.document_type = 'issue') as issue_count,
       -- SubQuery 2: completed_count (re-scans same tables)
       (SELECT COUNT(*) FROM documents i
        JOIN document_associations ida ON ida.document_id = i.id
          AND ida.related_id = d.id AND ida.relationship_type = 'sprint'
        WHERE i.document_type = 'issue'
          AND i.properties->>'state' = 'done') as completed_count,
       -- SubQuery 3: started_count (re-scans same tables again)
       (SELECT COUNT(*) FROM documents i
        JOIN document_associations ida ON ida.document_id = i.id
          AND ida.related_id = d.id AND ida.relationship_type = 'sprint'
        WHERE i.document_type = 'issue'
          AND i.properties->>'state' IN ('in_progress', 'in_review')) as started_count,
       -- SubQuery 4: has_plan
       (SELECT COUNT(*) > 0 FROM documents pl
        WHERE pl.parent_id = d.id
          AND pl.document_type = 'weekly_plan') as has_plan,
       -- SubQuery 5: has_retro (re-scans associations)
       (SELECT COUNT(*) > 0 FROM documents rt
        JOIN document_associations rda ON rda.document_id = rt.id
          AND rda.related_id = d.id AND rda.relationship_type = 'sprint'
        WHERE rt.properties->>'outcome' IS NOT NULL) as has_retro,
       -- SubQuery 6: retro_outcome (re-scans associations again)
       (SELECT rt.properties->>'outcome' FROM documents rt
        JOIN document_associations rda ON rda.document_id = rt.id
          AND rda.related_id = d.id AND rda.relationship_type = 'sprint'
        WHERE rt.properties->>'outcome' IS NOT NULL LIMIT 1) as retro_outcome,
       -- SubQuery 7: retro_id (re-scans associations a third time)
       (SELECT rt.id FROM documents rt
        JOIN document_associations rda ON rda.document_id = rt.id
          AND rda.related_id = d.id AND rda.relationship_type = 'sprint'
        WHERE rt.properties->>'outcome' IS NOT NULL LIMIT 1) as retro_id
FROM documents d
LEFT JOIN document_associations prog_da
  ON prog_da.document_id = d.id AND prog_da.relationship_type = 'program'
LEFT JOIN documents p ON prog_da.related_id = p.id
LEFT JOIN users u ON (d.properties->'assignee_ids'->>0)::uuid = u.id
WHERE d.workspace_id = (SELECT id FROM workspaces LIMIT 1)
  AND d.document_type = 'sprint'
ORDER BY (d.properties->>'sprint_number')::int, p.title;
