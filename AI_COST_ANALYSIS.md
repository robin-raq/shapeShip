# AI Cost Analysis

## Part 1: Development Costs (Claude Code for Audit & Remediation)

### Tool Used
- **Primary:** Claude Code (CLI agent, Claude Opus model)
- **Pricing tier:** Claude Max subscription ($100/month)

### Usage Summary

| Metric | Value |
|--------|-------|
| Claude Code sessions | ~8–10 sessions (Phases 1–4) |
| Approximate duration | ~16–20 hours of active session time |
| Total commits generated | 35 (across `fix/error-handling-and-test-infra` + `master`) |
| Total lines changed | 6,939 insertions, 1,012 deletions across 89 files |
| Files created | ~15 new files |
| Files modified | ~74 existing files |

### LLM API Costs

> **Note:** Claude Code runs on the Max subscription ($100/month). Per-token costs below are theoretical estimates if the same work were done via the raw Anthropic API at published Claude Opus rates. Actual spend is the flat subscription fee.

| Metric | Estimate | Notes |
|--------|----------|-------|
| Input tokens (estimated) | ~12–18M tokens | Codebase reads, grep results, file exploration across 8–10 sessions |
| Output tokens (estimated) | ~3–5M tokens | Code generation, explanations, analysis across all phases |
| Total tokens (estimated) | ~15–23M tokens | Combined I/O across entire audit |
| Estimated cost (at API Opus rates) | ~$230–370 | At $15/MTok input, $75/MTok output (theoretical) |
| Actual subscription cost | $100/month | Claude Max — flat rate, unlimited usage within limits |
| Estimated total actual spend | ~$100–200 | 1–2 months of Max subscription covering Phases 1–4 |

### Coding Agent Costs

| Agent | Cost model | Estimated spend |
|-------|-----------|-----------------|
| Claude Code (CLI) | Included in Max subscription | $100–200 (1–2 months) |
| Other tools (Cursor, Copilot, etc.) | N/A | $0 — not used |

---

## Part 2: Production AI Costs (AWS Bedrock Quality Assistant)

### What It Does

Ship includes an AI-powered Quality Assistant that analyzes sprint plans and retrospectives for quality. It uses **Claude claude-3-7-sonnet-20250219 on AWS Bedrock** (`us.anthropic.claude-3-7-sonnet-20250219-v1:0`).

Two analysis functions:
- **`analyzePlan(content)`** — Reviews sprint plan documents for completeness, risk, and quality
- **`analyzeRetro(retroContent, planContent)`** — Reviews retrospectives against the original plan

### Architecture & Cost Controls

| Control | Implementation | Cost Impact |
|---------|---------------|-------------|
| Rate limiting | 120 requests/user/hour | Prevents runaway costs from automation or abuse |
| Content size cap | 50KB max per request | Bounds input token costs |
| Content-change gating | SHA-256 hash comparison | Only calls Bedrock when document content actually changes |
| Frontend polling | 10-second intervals | Polls for cached result; does NOT call Bedrock each poll |
| Response caching | Stored in document `properties.ai_analysis` | Subsequent reads are free (no API call) |
| Token limit | `max_tokens: 2048` per response | Caps output cost per request |

### Per-Request Cost Estimate

| Component | Tokens | Cost |
|-----------|--------|------|
| System prompt (plan analysis) | ~500 tokens | $0.0015 |
| Document content (typical sprint plan) | ~2,000–8,000 tokens | $0.006–$0.024 |
| AI response (capped at 2,048 tokens) | ~1,000–2,048 tokens | $0.003–$0.006 |
| **Total per request** | ~3,500–10,500 tokens | **~$0.01–$0.03** |

> Based on Claude 3.7 Sonnet pricing: $3/MTok input, $3/MTok output (Bedrock cross-region inference).

### Monthly Cost Projections

| Scenario | Users | Requests/mo | Estimated monthly cost |
|----------|-------|-------------|----------------------|
| Light usage (pilot team) | 5 | ~50 | ~$0.50–$1.50 |
| Normal usage (full team) | 20 | ~200 | ~$2–$6 |
| Heavy usage (active sprint cycles) | 20 | ~500 | ~$5–$15 |
| Theoretical maximum (rate limit ceiling) | 20 | ~2,880/user | ~$50–$85 |

> **Why costs stay low:** The content-change gating means most "requests" are cache hits. A user editing a sprint plan might trigger 50 polls but only 3–5 actual Bedrock calls (each time the content hash changes). The rate limit of 120/user/hour is a safety ceiling, not typical usage.

### ROI Comparison

| Metric | Manual review | AI Quality Assistant |
|--------|--------------|---------------------|
| Time to review a sprint plan | 15–30 min | ~3 seconds |
| Cost per review | ~$15–30 (engineer time) | ~$0.01–$0.03 |
| Consistency | Varies by reviewer | Consistent criteria every time |
| Availability | Business hours only | 24/7 |
| Monthly cost (20 users) | $0 (but opportunity cost of engineer time) | ~$2–$6 |

---

## Reflection Questions

### Which parts of the audit were AI tools most helpful for? Least helpful?

**Most helpful:**
- **Codebase exploration and pattern recognition.** Claude Code was excellent at searching across 89+ files to find related code. Finding all 48 `any` types, cross-referencing SQL queries against TypeScript interfaces, and tracing Yjs lifecycle from Editor.tsx through the WebSocket server — these tasks would have taken hours manually. The grep/glob/read pipeline is faster than any IDE search.
- **Test infrastructure debugging.** The vitest workspace configuration issue (E2E `.spec.ts` files being picked up by vitest) and the `get-port` libuv crash were both diagnosed through rapid hypothesis-test cycles. Claude Code could read error output, form a theory, check the relevant config, and propose a fix in under a minute.
- **Generating boilerplate with context.** Writing 17 row type interfaces in `db-rows.ts` required reading 17 SQL queries and mapping columns. Claude Code did this mechanical work accurately, letting me focus on the design decisions (should we use inheritance? how to type JSONB properties?).
- **TypeScript strengthening utilities (Phase 4).** The `queryRow<T>()`, `queryRows<T>()`, `pgBool()`, and `narrowProperties<T>()` helpers were small utilities (~30 lines total) that required understanding pg driver generics, JSONB nullability, and boolean coercion. Claude Code wrote tests first (TDD), then implemented, then updated 15+ call sites — a high-volume mechanical task guided by precise type reasoning.

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

2. **`has_plan: boolean | string`.** The AI included `| string` as a "safe" fallback based on patterns seen in the codebase (the legacy `=== 't'` check in weeks.ts). I overrode this after verifying via the pg driver docs that modern pg returns native booleans. This led directly to the `pgBool()` utility in Phase 4 — codifying the correct behavior rather than perpetuating defensive guesses.

3. **E2E test count.** The AI initially reported inflated numbers (531 unit suites, 1025 total tests) by counting test.describe blocks and hooks alongside test() calls. I had to manually grep and verify the correct count: 49 unit suites, 621 unit tests, 71 E2E files, 866 E2E tests.

4. **`any` baseline count.** The audit initially reported 129 explicit `any` types. After I cloned the original Treasury repo and counted manually, the real number was 48 (the 129 included `.d.ts` declarations, test files, and comments). The AI didn't distinguish between source-code `any` and declaration-file `any`.

5. **`QueryParam` type widening (Phase 4).** The AI initially suggested a complex union type with `Date` and `Buffer` support. I narrowed it to just adding `string[]` — the only type actually needed for SQL `ANY()` operators — following YAGNI principles. The fix removed 3 `as any` casts without introducing unnecessary complexity.

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
| TypeScript strengthening (Phase 4) | ~85% | ~15% review | TDD approach guided output |
| Documentation (audit, improvements) | ~75% | ~25% editing | Framing was manual |

**Overall estimate: ~78% AI-generated code, ~22% human-directed corrections and design decisions.**

The 22% human contribution was disproportionately important — it caught the five errors listed above (false type inheritance, wrong boolean typing, inflated counts, inflated baselines, over-engineered QueryParam) that would have undermined the credibility of the entire audit.

---

## Summary

### Development Costs
- **Actual spend:** ~$100–200 (1–2 months of Claude Max subscription at $100/mo)
- **Theoretical API cost:** ~$230–370 (if billed at per-token Opus rates)
- **Output:** 35 commits, 89 files changed, 6,939 insertions / 1,012 deletions across 4 audit phases

### Production AI Costs
- **Service:** AWS Bedrock Claude 3.7 Sonnet (Quality Assistant for sprint plans/retros)
- **Per-request cost:** ~$0.01–$0.03
- **Projected monthly cost:** ~$2–$6 for a 20-person team under normal usage
- **Cost controls:** Rate limiting, content-change gating, response caching, token caps

### Key Takeaway
AI tools (Claude Code specifically) were most valuable as a **research accelerator** — rapidly finding code, cross-referencing patterns, and generating boilerplate. They were least valuable for **verification and judgment** — confirming runtime behavior, assessing design quality, and catching their own errors.

The meta-lesson: AI-assisted auditing requires a "trust but verify" discipline. The AI will produce plausible-looking results fast. The human's job is to spot the 22% that's wrong before it ships.
