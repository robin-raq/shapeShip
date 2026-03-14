/**
 * Type-safe interfaces for PostgreSQL query results and parameters.
 *
 * Each query row type declares EXACTLY the columns its SQL SELECT returns.
 * Property interfaces type the JSONB `properties` column per document type.
 *
 * Verified against:
 * - api/src/db/schema.sql (documents table definition)
 * - Actual SQL in routes/weeks.ts, issues.ts, projects.ts, programs.ts, feedback.ts
 * - pg driver behavior: COUNT→string, BOOLEAN→boolean, undefined→null
 */

// ---------------------------------------------------------------------------
// Query parameters
// ---------------------------------------------------------------------------

/**
 * SQL query parameter — types the pg driver accepts for parameterized queries.
 * NOTE: pg silently converts undefined→null, but we exclude it to prevent
 * accidental null insertion when the developer meant "not provided".
 */
export type QueryParam = string | number | boolean | null;

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/**
 * Normalize a PostgreSQL boolean value to a JavaScript boolean.
 *
 * pg v7+ returns native `boolean` for SQL BOOLEAN columns, but older drivers
 * or raw COALESCE/string aggregations may return 't'/'f'. This centralizes
 * the check so call sites don't need defensive `=== true || === 't'` patterns.
 */
export function pgBool(value: unknown): boolean {
  return value === true || value === 't';
}

/**
 * Narrow nullable JSONB properties to their concrete type.
 *
 * Replaces the common `row.properties || {}` pattern which widens
 * the type to `T | {}`, losing property autocompletion. This function
 * uses ?? (nullish coalescing) and preserves the generic T throughout.
 */
export function narrowProperties<T>(
  properties: T | null | undefined,
  defaults: T
): T {
  return properties ?? defaults;
}

// ---------------------------------------------------------------------------
// TipTap content
// ---------------------------------------------------------------------------

/** TipTap editor content (JSON representation of ProseMirror document). */
export interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

// ---------------------------------------------------------------------------
// Per-document-type JSONB properties
// ---------------------------------------------------------------------------

/** Properties stored in properties JSONB for sprint documents */
export interface SprintProperties {
  sprint_number?: number;
  status?: string; // 'planning' | 'active' | 'closed'
  plan?: string | null;
  success_criteria?: string | null;
  confidence?: number | null;
  plan_history?: unknown[] | null;
  is_complete?: boolean | null;
  missing_fields?: string[];
  planned_issue_ids?: string[] | null;
  snapshot_taken_at?: string | null;
  plan_approval?: Record<string, unknown> | null;
  review_approval?: Record<string, unknown> | null;
  review_rating?: string | null;
  accountable_id?: string | null;
}

/** Properties stored in properties JSONB for issue documents */
export interface IssueProperties {
  state?: string; // 'backlog' | 'triage' | 'in_progress' | 'in_review' | 'done' | 'cancelled'
  priority?: string; // 'low' | 'medium' | 'high' | 'critical'
  assignee_id?: string | null;
  estimate?: number | null;
  source?: string; // 'internal' | 'external' | 'action_items'
  rejection_reason?: string | null;
  due_date?: string | null;
  is_system_generated?: boolean;
  accountability_target_id?: string | null;
  accountability_type?: string | null;
  carryover_from_sprint_id?: string | null;
}

/** Properties stored in properties JSONB for project documents */
export interface ProjectProperties {
  impact?: number | null;
  confidence?: number | null;
  ease?: number | null;
  color?: string;
  emoji?: string | null;
  is_complete?: boolean | null;
  missing_fields?: string[];
  owner_id?: string | null;
  accountable_id?: string | null;
  consulted_ids?: string[];
  informed_ids?: string[];
  plan?: string | null;
  plan_approval?: Record<string, unknown> | null;
  retro_approval?: Record<string, unknown> | null;
  has_retro?: boolean;
  target_date?: string | null;
  has_design_review?: boolean | null;
  design_review_notes?: string | null;
  plan_validated?: unknown;
  monetary_impact_expected?: string | null;
  monetary_impact_actual?: string | null;
  success_criteria?: unknown[];
  next_steps?: string | null;
}

/** Properties stored in properties JSONB for program documents */
export interface ProgramProperties {
  color?: string;
  emoji?: string | null;
  owner_id?: string | null;
  prefix?: string | null;
  accountable_id?: string | null;
  consulted_ids?: string[];
  informed_ids?: string[];
}

/**
 * Union of all known property shapes.
 * Use the specific type (SprintProperties, IssueProperties, etc.) in extract
 * functions where you know the document type. Use this union for generic code.
 */
export type DocumentProperties =
  | SprintProperties
  | IssueProperties
  | ProjectProperties
  | ProgramProperties
  | Record<string, unknown>
  | null;

// ---------------------------------------------------------------------------
// Default property values for narrowProperties()
// ---------------------------------------------------------------------------

/** Empty defaults for narrowProperties() — use when properties is null */
export const EMPTY_SPRINT_PROPS: SprintProperties = {};
export const EMPTY_ISSUE_PROPS: IssueProperties = {};
export const EMPTY_PROJECT_PROPS: ProjectProperties = {};
export const EMPTY_PROGRAM_PROPS: ProgramProperties = {};

// ---------------------------------------------------------------------------
// Query row types — each matches EXACTLY what its SQL SELECT returns
// ---------------------------------------------------------------------------

/**
 * Sprint list/detail rows from weeks.ts CTE query.
 * SQL selects: d.id, d.title, d.properties + JOINed owner/program/counts/plan/retro.
 * Does NOT select: content, created_at, updated_at, archived_at, created_by, ticket_number.
 */
export interface SprintQueryRow {
  id: string;
  title: string;
  properties: SprintProperties | null;
  // JOINed owner
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  // JOINed program
  program_id: string | null;
  program_name: string | null;
  program_prefix: string | null;
  program_accountable_id: string | null;
  // JOINed project (some queries)
  project_id?: string | null;
  project_name?: string | null;
  // Other JOINed data
  owner_reports_to: string | null;
  workspace_sprint_start_date: string | null;
  // CTE aggregations — pg COUNT returns string
  issue_count: string;
  completed_count: string;
  started_count: string;
  // CTE plan/retro checks — pg COALESCE(TRUE/FALSE) returns boolean
  has_plan: boolean;
  has_retro: boolean;
  retro_outcome: string | null;
  retro_id: string | null;
}

/**
 * Issue list/detail rows from issues.ts.
 * SQL selects: d.id, d.title, d.properties, d.ticket_number, d.content,
 *   d.created_at, d.updated_at, d.created_by, d.started_at, d.completed_at,
 *   d.cancelled_at, d.reopened_at, d.converted_from_id + JOINed assignee/creator.
 */
export interface IssueQueryRow {
  id: string;
  title: string;
  properties: IssueProperties | null;
  ticket_number: number | null;
  content: TipTapNode | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  reopened_at: string | null;
  converted_from_id: string | null;
  // JOINed
  assignee_name: string | null;
  assignee_archived: boolean;
  created_by_name: string | null;
}

/**
 * Project list/detail rows from projects.ts.
 * SQL selects: d.id, d.title, d.properties, d.archived_at, d.created_at,
 *   d.updated_at, d.converted_from_id + JOINed owner/counts/status.
 */
export interface ProjectQueryRow {
  id: string;
  title: string;
  properties: ProjectProperties | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  converted_from_id: string | null;
  // JOINed program
  program_id: string | null;
  // JOINed owner
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  // Subquery counts — pg COUNT returns string
  sprint_count: string;
  issue_count: string;
  inferred_status: string | null;
}

/**
 * Program list/detail rows from programs.ts.
 * SQL selects: d.id, d.title, d.properties, d.archived_at, d.created_at,
 *   d.updated_at + JOINed owner/counts.
 */
export interface ProgramQueryRow {
  id: string;
  title: string;
  properties: ProgramProperties | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  // JOINed owner
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  // Subquery counts
  issue_count: string;
  sprint_count: string;
}

/**
 * Feedback list rows from feedback.ts.
 * SQL selects: d.id, d.title, d.properties, d.ticket_number, d.content,
 *   d.created_at, d.updated_at, d.created_by + JOINed program/creator.
 */
export interface FeedbackQueryRow {
  id: string;
  title: string;
  properties: Record<string, unknown> | null;
  ticket_number: number | null;
  content: TipTapNode | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  // JOINed program
  program_id: string | null;
  program_name: string | null;
  program_prefix: string | null;
  program_color: string | null;
  // JOINed creator
  created_by_name: string | null;
}

/** Row from standup queries (JOINed author + parent sprint) */
export interface StandupQueryRow {
  id: string;
  parent_id: string;
  title: string;
  content: TipTapNode | null;
  author_id: string;
  author_name: string;
  author_email: string;
  created_at: string;
  updated_at: string;
}

/**
 * Row shape for issue state filtering.
 * From: SELECT properties->>'state' as state, title FROM documents ...
 */
export interface IssueStateRow {
  state: string;
  title: string;
}

/** Lightweight issue summary used in grouped sprint views */
export interface GroupedIssue {
  id: string;
  title: string;
  state: string;
  priority: string;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_archived: boolean;
  estimate: number | null;
  ticket_number: number;
  display_id: string;
  created_at: string;
  updated_at: string;
}

/** Sprint summary data passed to generatePrefilledReviewContent */
export interface SprintReviewData {
  sprint_number: number;
  program_name: string | null;
  plan: string | null;
}

/** Issue row shape returned by the review pre-fill query */
export interface ReviewIssueRow {
  id: string;
  title: string;
  properties: IssueProperties | null;
  ticket_number: number | null;
}

/** Document row from canAccessDocument query */
export interface AccessCheckRow {
  can_access: boolean;
}
