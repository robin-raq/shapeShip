# Codebase Orientation Checklist — Ship (shapeShip)

**Reference Document**

- **Name:**
- **Date:** 2026-03-09
- **Repo URL:**

> Complete this checklist before auditing. The goal is to build a mental model of the entire system before measuring anything.

---

## PHASE 1: FIRST CONTACT

### Section 1 — Repository Overview

#### 1a. Setup Steps
*Document every step to get the app running locally, including anything not in the README.*

**Clean Steps to Get Running (from scratch):**

1. Clone the repo and `cd` into `shapeShip/`
2. Install dependencies: `pnpm install`
3. Ensure PostgreSQL is running locally on port 5432
4. Create the database role and database manually (not in README):
   ```
   psql -d postgres -c "CREATE ROLE ship WITH LOGIN PASSWORD 'ship_dev_password';"
   psql -d postgres -c "CREATE DATABASE ship_dev OWNER ship;"
   ```
5. Create `api/.env.local` with:
   ```
   DATABASE_URL=postgresql://ship:ship_dev_password@localhost:5432/ship_dev
   SESSION_SECRET=dev-secret-change-me
   CORS_ORIGIN=http://localhost:5173
   PORT=3000
   ```
6. Run migrations and seed the database:
   ```
   cd api
   DATABASE_URL="postgresql://ship:ship_dev_password@localhost:5432/ship_dev" npx tsx src/db/migrate.ts
   DATABASE_URL="postgresql://ship:ship_dev_password@localhost:5432/ship_dev" npx tsx src/db/seed.ts
   cd ..
   ```
7. Start both servers: `pnpm dev` (web on :5173, API on :3000)
8. Sign in at `http://localhost:5173` with `dev@ship.local` / `admin123`

**Important notes:**
- Do NOT run `pnpm db:seed` independently — it expects the role and schema to already exist.
- `pnpm dev` runs `scripts/dev.sh` which is *supposed* to bootstrap everything automatically, but local PostgreSQL auth config may prevent automatic role creation. The manual steps above are the reliable path.
- If you get a CORS error, verify `api/.env.local` has `CORS_ORIGIN=http://localhost:5173` (matching the actual web port), then fully restart the API.

---

**Detailed Troubleshooting Log (what actually happened):**

1. Cloned the repo
2. `pnpm install` — dependencies were already installed
3. `api/.env.local` and `web/.env` already existed from prior setup
4. PostgreSQL was already running locally on port 5432
5. **Error encountered:** Running `pnpm db:seed` independently failed with `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` — the seed script expects the database role (`ship`) and schema to already exist. The correct first-run command is `pnpm dev`, which bootstraps everything via `scripts/dev.sh`: creates the role, creates the database, runs migrations, seeds test data, then starts both servers.
6. Ran `pnpm dev` — the web server (port 5173) started successfully, but the API server (port 3000) never came up. The login page loaded but sign-in failed because the POST request had no backend to reach.
7. **Root cause:** The `ship` PostgreSQL role and `ship_dev` database were never created. `dev.sh` failed silently on the DB bootstrap step — likely due to local PostgreSQL auth configuration not allowing automatic role creation.
8. **Manual fix required (not in README):**
   ```
   psql -d postgres -c "CREATE ROLE ship WITH LOGIN PASSWORD 'ship_dev_password';"
   psql -d postgres -c "CREATE DATABASE ship_dev OWNER ship;"
   ```
9. Re-ran `pnpm dev` after manual DB setup — web server started but API still didn't come up. Database existed but had no tables (migrations didn't run automatically).
10. **Had to run migrations and seed manually:**
    ```
    cd api
    DATABASE_URL="postgresql://ship:ship_dev_password@localhost:5432/ship_dev" npx tsx src/db/migrate.ts
    DATABASE_URL="postgresql://ship:ship_dev_password@localhost:5432/ship_dev" npx tsx src/db/seed.ts
    ```
11. Migrations applied schema + 44 migration files successfully. Seed created test data.
12. **Login credentials from seed:** `dev@ship.local` / `admin123`
13. Restarted `pnpm dev` after manual migration + seed.
14. **CORS error:** Sign-in button stuck on "Signing in..." — browser console showed `Access-Control-Allow-Origin` header had value `http://localhost:5174` (wrong port) instead of `http://localhost:5173`. The API had cached a stale CORS config from a previous worktree.
15. **Fix:** Killed the API process (`lsof -ti :3000 | xargs kill -9`) and restarted with explicit `CORS_ORIGIN=http://localhost:5173` env var. Alternatively, ensure `api/.env.local` has the correct `CORS_ORIGIN` and do a full restart.
16. Successfully signed in with `dev@ship.local` / `admin123`. App loaded the Documents view with seeded data and an accountability action items popup.

#### 1b. Key Architectural Decisions
*Read every file in docs/. Summarize the key architectural decisions in your own words.*

1. **Everything is a document** — Instead of having separate tables for issues, wikis, projects, etc., they all live in one `documents` table. A `document_type` column and a `properties` JSONB column are what make an "issue" different from a "wiki page." This is inspired by Notion — same underlying structure, different properties on top. It keeps the schema simple and makes it easy to query across types.

2. **Boring tech on purpose** — The team picked Express, React + Vite, and raw SQL with the `pg` library instead of trendier options like Next.js or Prisma. The idea is that everyone on the team already knows these tools, there's less magic to debug, and you get full control over your queries without fighting an ORM.

3. **Collaborative editing with Yjs** — Every document uses the same TipTap rich-text editor, and edits sync between users in real time through Yjs CRDTs over WebSocket. The Yjs binary state gets saved to PostgreSQL, so you get Google Docs-style collaboration without building a custom sync engine.

4. **Monorepo with a shared types package** — `api/`, `web/`, and `shared/` all live in one repo using pnpm workspaces. The `shared/` package holds TypeScript types that both frontend and backend import, so the two sides can't go out of sync.

5. **Simple permissions** — There are no per-document access controls. You're either a member of the workspace or you're not. Auth lives in `workspace_memberships`, completely separate from the content in `documents`. Simple and secure.

6. **Server is the source of truth** — The app caches data locally with IndexedDB and TanStack Query for fast loads, but all writes go through the server. If a mutation fails, the optimistic UI update rolls back. It's offline-tolerant, not offline-first.

#### 1c. Shared Package Types
*Read the shared/ package. What types are defined? How are they used across frontend and backend?*

The `shared/src/types/` folder has 5 type files, all re-exported from `index.ts`:

- **`document.ts`** (the big one) — Defines the `DocumentType` union (`'wiki' | 'issue' | 'program' | 'project' | 'sprint' | 'person' | 'weekly_plan' | 'weekly_retro' | 'standup' | 'weekly_review'`), a base `Document` interface, and typed variants like `IssueDocument`, `ProgramDocument`, etc. Each document type has its own properties interface (e.g., `IssueProperties` has `state`, `priority`, `assignee_id`; `ProjectProperties` has ICE scores and approval tracking). There's also a `computeICEScore()` helper function.
- **`api.ts`** — A generic `ApiResponse<T>` wrapper and `ApiError` type. Every API response follows this shape.
- **`user.ts`** — `User` interface with `id`, `email`, `name`, `isSuperAdmin`, and `lastWorkspaceId`.
- **`workspace.ts`** — `Workspace`, `WorkspaceMembership`, `WorkspaceInvite`, `AuditLog`, plus response types like `WorkspaceWithRole` and `MemberWithUser`.
- **`auth.ts`** — Essentially empty now; auth types moved to the `api/` and `web/` packages locally.

Both `api/` and `web/` import from `@ship/shared` (via pnpm workspace protocol). This means when a property name changes in `document.ts`, both sides get a compile error immediately — no silent drift.

**How they're used in practice:** On the backend, API route handlers use types like `IssueDocument` and `IssueProperties` to type database query results and shape responses. On the frontend, React contexts (e.g., `IssuesContext`) and hooks use the same types to ensure the UI state matches what the API returns. The generic `ApiResponse<T>` wrapper means you can write `ApiResponse<IssueDocument[]>` and get type-safe data on both sides of the wire.

#### 1d. Package Relationship Diagram
*Draw or describe how web/, api/, and shared/ packages relate to each other.*

```
┌─────────────────────────────────────────────────┐
│                  pnpm workspace                 │
│               (pnpm-workspace.yaml)             │
│                                                 │
│  ┌──────────┐   imports    ┌──────────────┐     │
│  │  web/    │ ──────────── │   shared/    │     │
│  │ (React + │              │ (TypeScript  │     │
│  │  Vite)   │              │  types &     │     │
│  └────┬─────┘   imports    │  constants)  │     │
│       │        ┌────────── │              │     │
│       │        │           └──────────────┘     │
│  ┌────┴─────┐  │                                │
│  │  api/    │ ─┘                                │
│  │(Express +│                                   │
│  │   pg)    │                                   │
│  └──────────┘                                   │
└─────────────────────────────────────────────────┘

web/ ──proxy──▶ api/  (Vite dev server proxies /api, /collaboration, /events to Express)
web/ ──ws────▶ api/  (WebSocket for Yjs collaboration at /collaboration/{docType}:{docId})
```

- `shared/` has no dependencies on `api/` or `web/` — it's a leaf package
- `web/` and `api/` both depend on `shared/` via `"@ship/shared": "workspace:*"` in their `package.json`
- `web/` never talks to the database directly — everything goes through `api/` via REST or WebSocket
- `shared/` must be built first (`pnpm build:shared`) before `api/` or `web/` can compile

---

### Section 2 — Data Model

#### 2a. Database Tables & Relationships
*Find the database schema (migrations or seed files). Map out the tables and their relationships.*

Schema is defined in `api/src/db/schema.sql` with 44+ numbered migration files in `api/src/db/migrations/`. The main tables:

| Table | Purpose | Key Relationships |
|-------|---------|-------------------|
| `workspaces` | Multi-tenant container | Parent of most other tables |
| `users` | Global identity / auth | Can belong to multiple workspaces |
| `workspace_memberships` | Who can access which workspace | Links `users` ↔ `workspaces`, role: admin/member |
| `workspace_invites` | Email invite flow | Belongs to workspace, tracks token + expiry |
| `sessions` | Active login sessions | Links to user + workspace, 15-min inactivity / 12-hr absolute timeout |
| `documents` | **The big one** — all content lives here | Belongs to workspace, self-referencing `parent_id`, `created_by` → users |
| `document_associations` | Junction table for doc-to-doc relationships | `document_id` → `related_id` with `relationship_type` enum |
| `document_history` | Audit trail for field changes | Links to document + changed_by user |
| `document_snapshots` | State preservation before type conversions | Links to document |
| `document_links` | Backlinks (source → target) | Two FKs to documents |
| `comments` | Inline threaded comments | Links to document, supports parent_id for threading |
| `api_tokens` | CLI / external tool auth | Links to user + workspace, stores hashed token |
| `sprint_iterations` | Work progress per sprint | Links to sprint document |
| `issue_iterations` | Work progress per issue | Links to issue document |
| `files` | Uploaded images / attachments | Links to workspace + uploaded_by user |
| `audit_logs` | Compliance-grade action logging | Links to workspace + actor user |
| `oauth_state` | Survives server restarts during auth flow | Standalone, keyed by state_id |

**Core relationship diagram:**
```
workspaces ←── workspace_memberships ──→ users
     │
     └── documents (parent_id self-ref)
           └── document_associations (document_id, related_id → documents)
           └── document_links (source_id, target_id → documents)
           └── document_history (document_id → documents)
           └── comments (document_id → documents)
```

#### 2b. Unified Document Model
*How does one table serve docs, issues, projects, and sprints?*

The `documents` table has a few columns that do the heavy lifting:
- `document_type` — a PostgreSQL enum that says what kind of thing it is (wiki, issue, program, project, sprint, person, weekly_plan, weekly_retro, standup, weekly_review)
- `properties` — a JSONB column that holds type-specific data. An issue gets `state`, `priority`, `assignee_id`. A project gets ICE scores. A person gets `email`, `capacity_hours`. Same column, different shape per type.
- `content` — TipTap JSON stored as JSONB. Every document type uses the same rich text editor.
- `yjs_state` — binary blob (BYTEA) for Yjs CRDT collaboration state.

Not everything lives in `properties` though — some fields that are useful for queries or sorting are stored as explicit columns: `ticket_number` (auto-incremented per workspace), `archived_at`, `deleted_at`, `started_at`, `completed_at`. These are real columns because you need to index and filter on them efficiently, which is harder with JSONB.

So a "wiki page" and an "issue" are literally the same row structure. The only differences are the `document_type` value and what's inside `properties`. This means you can query all documents in one workspace with a single query and filter by type as needed.

#### 2c. document_type Discriminator
*What is the document_type discriminator? How is it used in queries?*

`document_type` is a PostgreSQL `ENUM` type with values: `wiki`, `issue`, `program`, `project`, `sprint`, `person`, `weekly_plan`, `weekly_retro`, `standup`, `weekly_review`.

In queries, it's used as a `WHERE` filter. For example, the issues route queries `SELECT * FROM documents WHERE document_type = 'issue' AND workspace_id = $1`. The programs page queries `WHERE document_type = 'program'`. There's a GIN index on `properties` and a regular index on `document_type` for performance.

On the TypeScript side, the shared package defines typed variants like `IssueDocument extends Document` with `document_type: 'issue'` and `properties: IssueProperties`. This means once you filter by type in a query, you can safely cast the result to the matching typed interface.

#### 2d. Document Relationships
*How does the application handle document relationships (linking, parent-child, project membership)?*

Three mechanisms:

1. **Parent-child** — The `documents` table has a `parent_id` column (self-referencing FK with `ON DELETE CASCADE`). This is the primary hierarchy mechanism — it's how documents nest under each other. A trigger prevents circular references. Migration 021 also copies `parent_id` values into `document_associations` with `relationship_type = 'parent'` for consistency, so the association table has a complete picture of all relationships.

2. **Associations** — The `document_associations` junction table handles many-to-many relationships with a `relationship_type` enum: `parent`, `project`, `sprint`, `program`. For example, an issue can belong to a project and a sprint at the same time by having two rows in this table. Legacy direct FK columns (`program_id`, `project_id`, `sprint_id`) were removed by migrations 027 and 029.

3. **Backlinks** — The `document_links` table tracks `source_id` → `target_id` when one document references another in its content. This powers the "backlinks" feature showing which documents link to the current one.

---

### Section 3 — Request Flow

#### 3a. Traced User Action
*Pick one user action and trace it from React component through API route to DB query and back.*

**Action chosen:** Creating a new issue

1. **React component** — User clicks "New Issue" button. The frontend calls a mutation via TanStack Query that POSTs to `/api/issues`.
2. **Vite proxy** — The dev server proxies `/api/*` to `http://localhost:3000` (configured in `web/vite.config.ts`).
3. **Express middleware chain** — The request hits Express and passes through: `helmet()` → `cors()` → `cookieParser()` → `express.json()` → rate limiter → session/CSRF middleware.
4. **Auth middleware** — `authMiddleware` in the issues router checks the session cookie, validates the session exists in the `sessions` table, and confirms it hasn't timed out (15-min inactivity / 12-hr absolute). Attaches `req.user` and `req.workspaceId`.
5. **Route handler** — `POST /api/issues` in `api/src/routes/issues.ts` validates the body with Zod (`createIssueSchema`), then runs an `INSERT INTO documents` query with `document_type = 'issue'`, the validated properties, and auto-incremented `ticket_number`.
6. **Associations** — If the request includes `belongs_to` entries (program, project, sprint), the handler inserts rows into `document_associations`.
7. **Response** — Returns the new document as JSON wrapped in `ApiResponse<IssueDocument>`.
8. **Frontend** — TanStack Query receives the response, updates the cache optimistically, and the issue appears in the list.

#### 3b. Middleware Chain
*Identify the middleware chain: what runs before every API request?*

From `api/src/app.ts`, the middleware runs in this order:

1. **`helmet()`** — Sets security headers (Content-Security-Policy, X-Frame-Options, etc.)
2. **`apiLimiter`** — General API rate limit (100 req/min in prod) applied to all `/api/*` routes
3. **`cors()`** — Validates the `Origin` header against `CORS_ORIGIN` env var
4. **`express.json()`** — Parses JSON request bodies (10MB limit for large wiki docs)
5. **`express.urlencoded()`** — Parses URL-encoded form bodies (for HTML form submissions)
6. **`cookieParser()`** — Parses cookies from the request
7. **`express-session`** — Session middleware (required for CSRF). 15-min cookie maxAge, HttpOnly, sameSite: strict.
8. **`loginLimiter`** — Stricter rate limit (5 failed attempts / 15 min) applied only to `/api/auth/login`
9. **CSRF protection** — `conditionalCsrf` checks the `x-csrf-token` header matches the session token. Skipped for Bearer token auth (API tokens aren't vulnerable to CSRF).
10. **Per-route `authMiddleware`** — Applied on each route file. Validates the session cookie, checks session isn't expired, and attaches `req.user` and `req.workspaceId`.

#### 3c. Authentication Flow
*How does authentication work? What happens to an unauthenticated request?*

Session-based auth with two login methods:

1. **Password login** — POST to `/api/auth/login` with email + password. The API verifies the password hash (bcrypt), creates a row in the `sessions` table with a crypto-random session ID, and sets an `HttpOnly` session cookie. Sessions have a 15-minute inactivity timeout and a 12-hour absolute timeout.

2. **PIV / CAIA (certificate-based)** — For government environments. The client presents an X.509 certificate, the API validates it against `x509_subject_dn` in the users table.

**Unauthenticated requests:** The `authMiddleware` checks for a valid session cookie (or Bearer API token). If missing or expired, it returns `401 Unauthorized` with `{ error: 'Not authenticated' }`. The frontend's API client intercepts 401s and redirects to the login page.

CSRF tokens are fetched via `GET /api/csrf-token` before any state-changing request and sent as the `x-csrf-token` header.

---

## PHASE 2: DEEP DIVE

### Section 4 — Real-time Collaboration

#### 4a. WebSocket Connection Establishment
*How does the WebSocket connection get established?*

The Express HTTP server is wrapped in `createServer()`, and `setupCollaboration(server)` attaches a `WebSocketServer` that listens on the `/collaboration` path. When a client opens a document, the TipTap editor creates a `WebsocketProvider` that connects to `ws://localhost:3000/collaboration/{docType}:{docId}`.

The server validates the session cookie from the upgrade request, checks session timeouts, and rate-limits connections per IP (max 30 per minute). If auth passes, the connection joins a "room" keyed by the document name.

#### 4b. Yjs State Sync Between Users
*How does Yjs sync document state between users?*

Yjs uses a sync protocol with two phases:
1. **Step 1** — When a client connects, it sends its current state vector (a summary of what changes it already has).
2. **Step 2** — The server responds with only the changes the client is missing, and vice versa.

After initial sync, any new edit generates a Yjs "update" that gets broadcast to all other connected clients in the same room. The server acts as a relay — it receives an update from one client and forwards it to everyone else connected to that document.

#### 4c. Concurrent Editing
*What happens when two users edit the same document at the same time?*

Yjs CRDTs handle this automatically. Each character insert gets a unique ID based on the client and a logical clock. If two users type at the same position simultaneously, Yjs deterministically resolves the order — no conflicts, no data loss. The result converges to the same state on all clients without any manual merge logic. This is the whole point of using CRDTs instead of Operational Transforms (like Google Docs uses internally).

#### 4d. Server-side Yjs Persistence
*How does the server persist Yjs state?*

When a document is opened, the server loads the existing `yjs_state` (BYTEA column) from the `documents` table and applies it to an in-memory Y.Doc. As edits come in, the server merges them into this Y.Doc. Periodically (and when the last client disconnects), the server encodes the full Y.Doc state back to binary and writes it to the `yjs_state` column. The `content` JSONB column is also updated by converting the Yjs document to TipTap JSON, so REST API reads always return current content even without going through WebSocket.

---

### Section 5 — TypeScript Patterns

**TypeScript Version:** 5.x (via root `tsconfig.json` targeting ES2022)

#### 5a. tsconfig.json Key Settings
*What are the key settings? Is strict mode on?*

Yes, **strict mode is on** (`"strict": true`) in the root `tsconfig.json`. Other notable settings:
- `target: "ES2022"` — modern JS features, no unnecessary downleveling
- `module: "NodeNext"` / `moduleResolution: "NodeNext"` (api) vs `module: "ESNext"` / `moduleResolution: "bundler"` (web) — backend uses Node's native ESM, frontend uses Vite's bundler resolution
- `noUncheckedIndexedAccess: true` — accessing array/object by index returns `T | undefined`, forces null checks
- `noImplicitReturns: true` — every code path must return a value
- `isolatedModules: true` — required for tools like Vite and esbuild that compile files individually
- `declaration: true` + `declarationMap: true` — generates `.d.ts` files (important for `shared/` package)

#### 5b. Type Sharing Between Frontend & Backend
*How are types shared between frontend and backend via the shared/ package?*

The `shared/` package compiles to `shared/dist/` with `.d.ts` type declarations. Both `api/` and `web/` reference it via `"@ship/shared": "workspace:*"` in their `package.json`. The api `tsconfig.json` maps `@ship/shared` to `../shared/dist` via `paths`. The web `tsconfig.json` uses a project reference (`"references": [{ "path": "../shared" }]`). Either way, when you import `{ IssueDocument } from '@ship/shared'`, you get the exact same type on both sides.

#### 5c. Code Examples Found
*Find examples of each pattern. Note the file path and line number.*

**Generics**
- File & line: `shared/src/types/api.ts:2`
- Description: `ApiResponse<T = unknown>` — a generic wrapper that lets you specify the data type of any API response. Used as `ApiResponse<IssueDocument[]>` etc.

**Discriminated Unions**
- File & line: `shared/src/types/document.ts:34-44`
- Description: `DocumentType` is a union of string literals. Combined with typed variants like `IssueDocument` (which narrows `document_type` to `'issue'`), it forms a discriminated union — you can switch on `document_type` and TypeScript narrows the `properties` type automatically.

**Utility Types (Partial, Pick, Omit)**
- File & line: `shared/src/types/document.ts:320`
- Description: `Partial<ProjectProperties>` used for `DEFAULT_PROJECT_PROPERTIES` — only some fields are set at creation time, the rest default to null.

**Type Guards**
- File & line: `api/src/routes/issues.ts:29-43`
- Description: Zod schemas (`createIssueSchema`) act as runtime type guards — `z.object().parse()` validates incoming data and narrows the type from `unknown` to the validated shape. If validation fails, it throws before any DB query runs.

#### 5d. Unfamiliar Patterns
*Are there any patterns you do not recognize? Research and describe them.*

- **CRDT (Conflict-free Replicated Data Type)** — Yjs implements CRDTs, which are data structures that can be edited independently on multiple clients and always merge to the same result without conflicts. Unlike traditional merge strategies, CRDTs guarantee convergence mathematically. The tradeoff is memory overhead — every character has metadata.

- **CSRF Sync Token Pattern** — The `csrf-sync` library generates a token tied to the session, returned via a dedicated endpoint. The frontend includes it as `x-csrf-token` on every mutating request. This prevents cross-site request forgery because an attacker's page can't read the token from a different origin.

---

### Section 6 — Testing Infrastructure

#### 6a. Playwright Test Structure & Fixtures
*How are the Playwright tests structured? What fixtures are used?*

E2E tests use Playwright (`@playwright/test` v1.57+) and are configured in the root `package.json` with `pnpm test:e2e`. Tests are organized by feature area. Custom fixtures in `e2e/fixtures/isolated-env.ts` set up isolated test environments — they create test users, workspaces, and seed data so each test suite runs independently. The CLAUDE.md explicitly warns never to run `pnpm test:e2e` directly (output explosion crashes Claude Code) — use the `/e2e-test-runner` skill instead.

#### 6b. Test Database Setup & Teardown
*How does the test database get set up and torn down?*

Unit tests (Vitest) run against a real PostgreSQL database. The test setup creates a fresh database, runs migrations, and seeds it. Tests use the same `pg` pool as the app. For E2E tests, the fixtures create isolated data per test suite to avoid cross-test contamination. Testcontainers may be used for full isolation (spinning up a fresh Postgres container per test run).

#### 6c. Test Suite Results
*Run the full test suite. Record results below.*

| | Pass | Fail | Duration |
|---|---|---|---|
| Unit tests | 451 | 0 | 37s |
| E2E tests | *in progress* | 22+ failures (accessibility) | >20 min (still running) |

**All passing?** Unit tests: Yes, all 451 pass across 28 test files. E2E: Still running at time of submission — early results show accessibility remediation tests failing (retry directories for contrast, ARIA attributes, heading hierarchy, label associations, etc.).

**Notes:** Unit tests run via Vitest against a real PostgreSQL database. The stderr output during unit tests (e.g., "Auth middleware error", "Activity fetch error") is expected — those are tests intentionally triggering error paths. E2E tests use Playwright with isolated fixtures and run against a live dev server. The failing accessibility tests suggest the UI has known a11y gaps being tracked for remediation.

---

### Section 7 — Build and Deploy

#### 7a. Dockerfile
*Read the Dockerfile. What does the build process produce?*

The main `Dockerfile` is lean — it doesn't build inside the container. Instead, `shared/` and `api/` are built locally first (`pnpm build:shared && pnpm build`), then the pre-built `dist/` directories are copied in. The container installs only production dependencies (`pnpm install --frozen-lockfile --prod`), sets `NODE_ENV=production`, exposes port 80, and runs migrations before starting the Express server (`node dist/db/migrate.js && node dist/index.js`). Base image is `node:20-slim` from ECR Public (Docker Hub is blocked in government environments).

There are also `Dockerfile.dev` (for local Docker dev) and `Dockerfile.web` (for frontend builds).

#### 7b. docker-compose.yml
*What services does it start?*

Just PostgreSQL 16. The `docker-compose.yml` is optional — most devs use native PostgreSQL. It creates a `postgres` service with `ship_dev` database, `ship` user, password `ship_dev_password`, exposed on port 5432, with a persistent volume and health check. No app containers — the app runs natively with `pnpm dev`.

#### 7c. Terraform Configuration
*Skim the Terraform configs. What cloud infrastructure does the app expect?*

The `terraform/` directory has modules for the full AWS stack:

- **VPC** (`vpc.tf`, `modules/vpc/`) — Private networking, subnets, NAT gateway
- **Elastic Beanstalk** (`elastic-beanstalk.tf`, `modules/elastic-beanstalk/`) — Runs the API Docker container, handles auto-scaling and load balancing
- **Aurora PostgreSQL** (`database.tf`, `modules/aurora/`) — Managed PostgreSQL (Aurora) for the database
- **S3 + CloudFront** (`s3-cloudfront.tf`, `modules/cloudfront-s3/`) — Static frontend hosting with CDN
- **SSM Parameter Store** (`ssm.tf`, `modules/ssm/`) — Secrets management (DATABASE_URL, SESSION_SECRET, etc.)
- **Security Groups** (`security-groups.tf`, `modules/security-groups/`) — Network access rules
- **WAF** (`waf.tf`) — Web Application Firewall for DDoS and bot protection
- **CloudFront Logging** (`cloudfront-logging.tf`) — Access logs for compliance

Three environments: `dev`, `shadow` (UAT), `prod` — each in `terraform/environments/`.

#### 7d. CI/CD Pipeline
*How does the CI/CD pipeline work (if configured)?*

No traditional CI/CD pipeline config (no `.github/workflows/` or similar) was found in the repo. Deploys are done manually via scripts:
- `./scripts/deploy.sh prod` — Builds the API Docker image and deploys to Elastic Beanstalk
- `./scripts/deploy-frontend.sh prod` — Builds the Vite frontend and syncs to S3, invalidates CloudFront cache

The deploy process is: build locally → push Docker image → deploy to EB (API) or sync to S3 (frontend). Pre-commit hooks enforce security compliance (`comply opensource`).

---

## PHASE 3: SYNTHESIS

### Section 8 — Architecture Assessment

#### 8a. Three Strongest Architectural Decisions
*What are the 3 strongest architectural decisions in this codebase? Why?*

1. **Unified Document Model** — Putting everything in one table with a JSONB properties column is clever. It means adding a new document type is just adding a new enum value and a properties interface — no migrations to create new tables, no new CRUD routes. Cross-type features like search, backlinks, and comments work on all types automatically.

2. **Shared types package** — Having `@ship/shared` as the single source of truth for TypeScript types prevents the classic "frontend expects X, backend sends Y" bug. A type change breaks both sides at compile time, not at runtime in production.

3. **Yjs for collaboration** — Using a battle-tested CRDT library instead of rolling their own sync engine was smart. It gives real-time collaboration with conflict resolution for free, and the same approach works for every document type since they all use the same TipTap editor.

#### 8b. Three Weakest Points
*What are the 3 weakest points? Where would you focus improvement?*

1. **Local setup is fragile** — `dev.sh` is supposed to bootstrap everything, but it fails silently when PostgreSQL auth doesn't allow automatic role creation. The README doesn't document the manual steps. A new developer could easily spend 30+ minutes just getting the app to run (as we did).

2. **No CI/CD pipeline** — Deploys are manual scripts. There are no automated tests on PR, no build checks, no deployment gates. For a production government app, this is a risk — a broken build can reach production.

3. **Single Express process for everything** — The same Node.js process serves REST, WebSocket, and Yjs collaboration. Under load, a slow DB query can block WebSocket sync, or heavy collaboration traffic can starve API requests. Separating the collaboration server would improve reliability.

#### 8c. New Engineer Onboarding
*If you had to onboard a new engineer to this codebase, what would you tell them first?*

"Everything is a document." That's the one mental model you need to understand before touching anything. There's one `documents` table, one `document_type` enum, and one TipTap editor shared across all content types. Don't create new tables for new content — add a new enum value and a properties interface in `shared/`. Read `docs/unified-document-model.md` and `docs/document-model-conventions.md` before writing any code. Use `pnpm dev` to start everything, but if the API doesn't come up, check that the PostgreSQL role and database exist manually.

#### 8d. Scaling to 10x Users
*What would break first if this app had 10x more users?*

The WebSocket collaboration server would struggle first. Every open document keeps a persistent WebSocket connection and an in-memory Y.Doc on the server. With 10x users, that's 10x memory for Yjs state and 10x more concurrent connections on a single Express process. The database (raw SQL, no connection pooling layer like PgBouncer mentioned) could also bottleneck — each request gets its own `pg` pool connection. Aurora helps with read scaling, but write-heavy workloads (every keystroke triggers a Yjs update that eventually persists) could overwhelm a single writer node.



---

*End of Checklist. Review your answers, ensure diagrams are complete, and submit.*
