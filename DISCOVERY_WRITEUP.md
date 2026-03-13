# Discovery Write-Up

Three things I discovered while auditing and remediating the Ship codebase.

---

## Discovery 1: The Unified Document Model ("Everything Is a Document")

### Where I Found It

- **Schema:** `api/src/db/schema.sql`, lines 99–162 — `document_type` enum and `CREATE TABLE documents`
- **Junction table:** `api/src/db/schema.sql`, lines 209–222 — `document_associations`
- **Row types:** `api/src/types/db-rows.ts`, lines 134–270 — `SprintQueryRow`, `IssueQueryRow`, `ProjectQueryRow`, etc.
- **Design doc:** `docs/unified-document-model.md`

### What It Does and Why It Matters

Ship stores issues, wiki pages, projects, programs, sprints, standups, retros, and weekly plans in **one `documents` table** with a `document_type` enum discriminator. Every document type shares:

- A `content` column (TipTap JSON) for rich text
- A `yjs_state` column (binary) for real-time CRDT sync
- A `properties` column (JSONB) for type-specific fields (state, priority, sprint_number, etc.)
- A `document_associations` junction table for relationships (parent, project, sprint, program)

This is the same pattern Notion uses. The benefit is that every document type automatically gets real-time collaboration, the same TipTap editor, the same 4-panel layout, and the same API patterns — for free. Adding a new document type means inserting an enum value and defining its properties, not building a new table, new API, new editor, and new sync logic.

The tradeoff I experienced firsthand: when I built `db-rows.ts` type interfaces, every row type maps to the same table but SELECTs different columns via JOINs and aggregates. `SprintQueryRow` has `has_plan`, `issue_count`, `completed_count` from CTEs. `IssueQueryRow` has `assignee_name`, `assignee_archived` from a user JOIN. Same table, wildly different shapes. You lose the simple "one interface per table" mapping that ORMs give you, and instead need per-query row types. This is the hidden cost of the unified model — type safety requires more discipline.

### How I Would Apply This

I would use this pattern in any project management or content platform where multiple content types share behavior (editing, collaboration, permissions, search). The key prerequisite is that the types genuinely share infrastructure. If issues need completely different editing UX from wiki pages, the unified model creates coupling rather than reuse.

The implementation lesson: skip ORMs, use per-query row interfaces that declare exactly the columns each SQL SELECT returns, and type the JSONB discriminator fields per document type.

---

## Discovery 2: PostgreSQL `pg` Driver Type Coercion (Booleans, Counts, and Nulls)

### Where I Found It

- **Boolean behavior:** `api/src/types/db-rows.ts`, lines 157–159 — `has_plan: boolean` with comment "pg COALESCE(TRUE/FALSE) returns boolean"
- **Legacy string comparison:** `api/src/routes/weeks.ts`, lines 550–551 — `row.has_plan === true || row.has_plan === 't'`
- **Fixed comparison:** `api/src/routes/weeks.ts`, lines 275–276 — `has_plan: row.has_plan === true`
- **Count typing:** `api/src/types/db-rows.ts`, lines 153–156 — `issue_count: string` with comment "pg COUNT returns string"
- **parseInt parsing:** `api/src/routes/weeks.ts`, lines 272–274 — `parseInt(row.issue_count) || 0`
- **QueryParam:** `api/src/types/db-rows.ts`, lines 17–22 — type excludes `undefined` with comment about silent null conversion

### What It Does and Why It Matters

The Node.js `pg` driver does not return JavaScript types the way you'd expect from the SQL column types. Three behaviors caught me off guard:

1. **BOOLEAN columns return JS `boolean`** — not the strings `'t'` or `'f'`. The Ship codebase had defensive `=== 't'` checks (weeks.ts line 550) that were dead code. The old `pg` driver (pre-v7, circa 2017) returned boolean strings, so legacy code that was never cleaned up creates a false impression that this is still needed. I removed the dead branch.

2. **COUNT(\*) returns JS `string`** — because PostgreSQL's `count()` returns `bigint` (8 bytes), and JavaScript's `number` only safely holds 53-bit integers, the `pg` driver serializes it as a string. Every `count` result needs `parseInt()`. If you type it as `number`, TypeScript won't complain, but you'll get string concatenation instead of addition when you do `count + 1` → `"421"` instead of `42`.

3. **`undefined` parameters silently become `null`** — if you pass `undefined` as a query parameter, `pg` converts it to SQL `NULL` without warning. This means TypeScript's `undefined` and SQL's `NULL` are conflated. Our `QueryParam` type excludes `undefined` to force callers to be explicit.

### How I Would Apply This

In any Node.js + PostgreSQL project, I would:
- Create a `QueryParam` type that excludes `undefined` to prevent silent null injection
- Type all `COUNT(*)` results as `string` and wrap parsing in a utility: `const toInt = (s: string) => parseInt(s, 10) || 0`
- Never use `=== 't'` for booleans — the modern `pg` driver returns native booleans
- Document these behaviors in the type file with inline comments (as we now do in `db-rows.ts`)

This discovery matters because it's invisible — TypeScript compiles either way. The bugs only appear at runtime as NaN arithmetic, wrong if-branches, or unexpected nulls.

---

## Discovery 3: Yjs CRDT + BroadcastChannel Multi-Tab Data Loss

### Where I Found It

- **Y.Doc creation:** `web/src/components/Editor.tsx`, line 198 — `const ydoc = useMemo(() => new Y.Doc(), [documentId])`
- **IndexedDB persistence:** `web/src/components/Editor.tsx`, line 295 — `new IndexeddbPersistence(\`ship-${roomPrefix}-${documentId}\`, ydoc)`
- **The fix (destroy on unmount):** `web/src/components/Editor.tsx`, lines 499–501 — `ydoc.destroy()`
- **Server-side sync:** `api/src/collaboration/index.ts`, lines 195–279 — `getOrCreateDoc()`
- **Cache clear protocol:** `api/src/collaboration/index.ts`, lines 691–701 — custom message type 3

### What It Does and Why It Matters

Yjs is a CRDT (Conflict-free Replicated Data Type) library that enables real-time collaborative editing. Ship uses three layers of Yjs synchronization:

1. **WebSocket** (`y-websocket`) — server-authoritative sync between browser clients
2. **IndexedDB** (`y-indexeddb`) — local offline cache so edits survive page refreshes
3. **BroadcastChannel** (built into `y-indexeddb`) — cross-tab sync within the same browser origin

The bug: when a user navigated away from a document, React unmounted the Editor component, but the old `Y.Doc` instance was never destroyed. The `y-indexeddb` provider kept its `BroadcastChannel` listener alive. When the user opened a *different* document in a new tab, the old Y.Doc received BroadcastChannel messages meant for the new document, merged them into its state, and wrote the merged (corrupted) result back to IndexedDB. On the next page load, IndexedDB loaded the corrupted state, and one set of edits was silently lost.

The fix was a single line — `ydoc.destroy()` — in the useEffect cleanup (line 501). This stops the BroadcastChannel listener, preventing the stale Y.Doc from processing messages it shouldn't receive. The server side also has a complementary mechanism: it sends a custom "clear cache" message (type 3) when a document was loaded fresh from JSON rather than Yjs state, so the browser knows to discard its IndexedDB cache.

### How I Would Apply This

This taught me three things about CRDT-based collaboration:

1. **Always destroy Y.Doc on unmount.** The library's cross-tab sync is powerful but creates invisible side effects if lifecycle isn't managed. Treat Y.Doc like a WebSocket connection — close it when you're done.

2. **Offline-first has hidden complexity.** IndexedDB persistence and BroadcastChannel are features you get "for free" from `y-indexeddb`, but they create state management surface area that outlives React's component lifecycle. The bug wasn't in the CRDT algorithm — it was in the glue code.

3. **Cache invalidation is a protocol problem.** Ship solved it with a custom WebSocket message type (type 3 = "clear your IndexedDB cache") and a close code (4101 = "content updated via API"). When you have multiple caching layers (memory, IndexedDB, server), you need explicit signals between them.
