# AI Cost Analysis

## Development Costs

### Tool Used
- **Primary:** Claude Code (CLI agent, Claude Opus model)
- **Pricing tier:** Claude Pro / Max subscription

### Usage Summary

| Metric | Value |
|--------|-------|
| Claude Code sessions | ~4–5 sessions |
| Approximate duration | ~8–10 hours of active session time |
| Total commits generated | 17 (on `fix/error-handling-and-test-infra`) |
| Total lines changed | 2,642 insertions, 336 deletions across 44 files |
| Files created | 8 new files |
| Files modified | 36 existing files |

### LLM API Costs

> **Note:** Claude Code runs on a subscription model (Pro/Max). Per-token costs below are estimates based on published Claude Opus pricing. Pull exact numbers from your Anthropic Console or Claude Code billing dashboard.

| Metric | Estimate | How to verify |
|--------|----------|---------------|
| Input tokens | [FILL IN from billing dashboard] | Anthropic Console → Usage |
| Output tokens | [FILL IN from billing dashboard] | Anthropic Console → Usage |
| Total tokens | [FILL IN from billing dashboard] | Anthropic Console → Usage |
| Number of API calls | [FILL IN from billing dashboard] | Anthropic Console → Usage |
| Estimated cost (at Opus rates) | [FILL IN from billing dashboard] | $15/M input, $75/M output |
| Subscription cost (if applicable) | [FILL IN — Pro: $20/mo, Max: $100/200/mo] | claude.ai/settings |

### Coding Agent Costs

| Agent | Cost model | Estimated spend |
|-------|-----------|-----------------|
| Claude Code (CLI) | Included in subscription | [FILL IN] |
| Other tools (Cursor, Copilot, etc.) | N/A or [FILL IN] | [FILL IN] |

---

## Reflection Questions

### Which parts of the audit were AI tools most helpful for? Least helpful?

**Most helpful:**
- **Codebase exploration and pattern recognition.** Claude Code was excellent at searching across 44+ files to find related code. Finding all 48 `any` types, cross-referencing SQL queries against TypeScript interfaces, and tracing Yjs lifecycle from Editor.tsx through the WebSocket server — these tasks would have taken hours manually. The grep/glob/read pipeline is faster than any IDE search.
- **Test infrastructure debugging.** The vitest workspace configuration issue (E2E `.spec.ts` files being picked up by vitest) and the `get-port` libuv crash were both diagnosed through rapid hypothesis-test cycles. Claude Code could read error output, form a theory, check the relevant config, and propose a fix in under a minute.
- **Generating boilerplate with context.** Writing 17 row type interfaces in `db-rows.ts` required reading 17 SQL queries and mapping columns. Claude Code did this mechanical work accurately, letting me focus on the design decisions (should we use inheritance? how to type JSONB properties?).

**Least helpful:**
- **Verifying runtime behavior.** Whether `pg` returns `boolean` or `'t'`/`'f'` for a BOOLEAN column is not something you can determine by reading code — you need to run a query. I had to verify this through actual database queries and pg driver documentation, not AI inference.
- **Understanding "why" behind original decisions.** Claude Code could tell me *what* the unified document model does, but the *why* — the team's constraints, the alternatives they rejected, the politics of "boring technology" — required reading the design docs and thinking about it myself.
- **E2E test execution.** Running 866 Playwright tests is inherently slow. AI didn't speed up the actual test runs, and interpreting flaky failures required human judgment about timing, port conflicts, and seed data.

### Did AI tools help you understand the codebase, or did they shortcut understanding?

**Both, depending on the task.**

AI accelerated understanding for *structural* questions: "Where is the documents table defined?", "What files use `any`?", "How does the WebSocket server persist Yjs state?" These are questions with definitive answers that just require finding the right code.

AI shortcut understanding for *design* questions. When Claude Code generated the initial `db-rows.ts` types (Round 1), they compiled but were wrong — `DocumentBaseRow` inherited columns that some queries never SELECT. I only caught this because I manually read the SQL in `weeks.ts` and compared it column-by-column against the interface. If I had trusted the AI output without verification, I would have shipped types that gave false safety guarantees.

The lesson: AI is a force multiplier for exploration but a crutch for comprehension. Reading code yourself — even slowly — builds mental models that AI summaries don't.

### Where did you have to override or correct AI suggestions? Why?

1. **db-rows.ts Round 1 → Round 2.** The initial AI-generated types used an inheritance pattern (`DocumentBaseRow` with shared columns) that was architecturally clean but factually wrong. Each SQL query SELECTs different columns — you can't share a base type. I had to reject the abstraction and manually verify each query's SELECT list.

2. **`has_plan: boolean | string`.** The AI included `| string` as a "safe" fallback based on patterns seen in the codebase (the legacy `=== 't'` check in weeks.ts). I overrode this after verifying via the pg driver docs that modern pg returns native booleans.

3. **E2E test count.** The AI initially reported inflated numbers (531 unit suites, 1025 total tests) by counting test.describe blocks and hooks alongside test() calls. I had to manually grep and verify the correct count: 49 unit suites, 621 unit tests, 71 E2E files, 866 E2E tests.

4. **`any` baseline count.** The audit initially reported 129 explicit `any` types. After I cloned the original Treasury repo and counted manually, the real number was 48 (the 129 included `.d.ts` declarations, test files, and comments). The AI didn't distinguish between source-code `any` and declaration-file `any`.

### What percentage of your final code changes were AI-generated vs. hand-written?

| Category | AI-generated | Human-directed | Human-written |
|----------|-------------|----------------|---------------|
| Type interfaces (db-rows.ts) | ~70% first draft | ~30% corrections | Design decisions |
| SQL CTE rewrites | ~80% | ~20% review | — |
| Test fixes (vitest config, stale expectations) | ~90% | ~10% review | — |
| Error handling middleware | ~85% | ~15% review | — |
| Bundle splitting (lazy loading) | ~80% | ~20% review | — |
| Accessibility fixes | ~90% | ~10% review | — |
| CRDT BroadcastChannel fix | ~50% | ~50% design | Key insight was manual |
| Documentation (audit, improvements) | ~75% | ~25% editing | Framing was manual |

**Overall estimate: ~75% AI-generated code, ~25% human-directed corrections and design decisions.**

The 25% human contribution was disproportionately important — it caught the four errors listed above (false type inheritance, wrong boolean typing, inflated counts, inflated baselines) that would have undermined the credibility of the entire audit.

---

## Summary

AI tools (Claude Code specifically) were most valuable as a **research accelerator** — rapidly finding code, cross-referencing patterns, and generating boilerplate. They were least valuable for **verification and judgment** — confirming runtime behavior, assessing design quality, and catching their own errors.

The meta-lesson: AI-assisted auditing requires a "trust but verify" discipline. The AI will produce plausible-looking results fast. The human's job is to spot the 25% that's wrong before it ships.
