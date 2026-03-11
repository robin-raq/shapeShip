/**
 * Type-safe interfaces for PostgreSQL query results and parameters.
 *
 * Replaces `any` in extractXFromRow() functions and query parameter arrays.
 * Each interface matches the columns returned by the corresponding SQL query.
 */

/** SQL query parameter — the types pg accepts for parameterized queries */
export type QueryParam = string | number | boolean | null | undefined;

/** Properties JSONB column shape — type-specific data stored as JSON */
export type DocumentProperties = Record<string, unknown> | null;

/**
 * TipTap editor content (JSON representation of ProseMirror document).
 * Recursive structure: each node can contain child nodes.
 */
export interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

/** Base columns present in all document query results */
interface DocumentBaseRow {
  id: string;
  title: string;
  properties: DocumentProperties;
  content: unknown;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  created_by: string;
  ticket_number: number | null;
}

/** Row from project list/detail queries (includes JOINed owner + counts) */
export interface ProjectQueryRow extends DocumentBaseRow {
  program_id: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  sprint_count: string;
  issue_count: string;
  inferred_status: string | null;
  converted_from_id: string | null;
}

/** Row from sprint list/detail queries (includes JOINed owner + program + counts) */
export interface SprintQueryRow extends DocumentBaseRow {
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  program_id: string | null;
  program_name: string | null;
  program_prefix: string | null;
  program_accountable_id: string | null;
  owner_reports_to: string | null;
  project_id: string | null;
  project_name: string | null;
  workspace_sprint_start_date: string | null;
  issue_count: string;
  completed_count: string;
  started_count: string;
  has_plan: boolean | string;
  has_retro: boolean | string;
  retro_outcome: string | null;
  retro_id: string | null;
}

/** Row from issue list/detail queries (includes JOINed assignee + creator) */
export interface IssueQueryRow extends DocumentBaseRow {
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  reopened_at: string | null;
  converted_from_id: string | null;
  assignee_name: string | null;
  assignee_archived: boolean | string;
  created_by_name: string | null;
}

/** Row from program list/detail queries (includes JOINed owner + counts) */
export interface ProgramQueryRow extends DocumentBaseRow {
  issue_count: string;
  sprint_count: string;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
}

/** Row from feedback list queries */
export interface FeedbackQueryRow extends DocumentBaseRow {
  program_id: string | null;
  program_name: string | null;
  program_prefix: string | null;
  program_color: string | null;
  created_by_name: string | null;
}

/** Row from standup queries (JOINed author + parent sprint) */
export interface StandupQueryRow {
  id: string;
  parent_id: string;
  title: string;
  content: unknown;
  author_id: string;
  author_name: string;
  author_email: string;
  created_at: string;
  updated_at: string;
}

/** Row shape for issue state filtering (from SELECT properties->>'state' as state) */
export interface IssueStateRow {
  state: string;
  title: string;
  [key: string]: unknown;
}

/** Lightweight issue summary used in grouped sprint views */
export interface GroupedIssue {
  id: string;
  title: string;
  state: string;
  priority: string;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_archived: boolean | string;
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

/** Issue row shape returned by the review pre-fill query (id, title, properties, ticket_number) */
export interface ReviewIssueRow {
  id: string;
  title: string;
  properties: DocumentProperties;
  ticket_number: number | null;
}

/** Document row from canAccessDocument query */
export interface AccessCheckRow {
  can_access: boolean;
  [key: string]: unknown;
}
